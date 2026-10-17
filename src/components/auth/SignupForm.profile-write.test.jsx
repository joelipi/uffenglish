// Regression guard for the signup profile write.
//
// Bug: useSignupForm wrote the profile with a plain `.insert(...)` while the
// fire-and-forget geo/referrer collection (collect-signup-data.js ->
// syncUserMetaDataMutation) ALSO writes that row, via an upsert. Which landed
// first was a network race. When geo won, the insert failed with
// `duplicate key value violates unique constraint "user_profiles_pkey"`:
// the account existed, signup reported failure, and the row kept a NULL email
// because only the geo columns had ever been written.
//
// The fix is `.upsert({...}, { onConflict: 'id' })`, which is idempotent and
// order-independent. These assertions fail if that is ever reverted to insert.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const { insertCalls, upsertOpts, signUpSpy } = vi.hoisted(() => ({
    insertCalls: [],
    upsertOpts: [],
    signUpSpy: vi.fn(),
}));

vi.mock('../../modules/api/supabase.js', () => ({
    supabase: {
        auth: { signUp: (...args) => signUpSpy(...args) },
        from: () => ({
            upsert: (row, opts) => {
                upsertOpts.push(opts);
                insertCalls.push(row);
                return Promise.resolve({ error: null });
            },
            insert: (row) => {
                insertCalls.push(row);
                return Promise.resolve({ error: null });
            },
        }),
    },
}));

vi.mock('../../modules/api/api.js', () => ({
    queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
    fetchGeoInfo: vi.fn(async () => ({ ip: '1.2.3.4' })),
    getCurrentSession: vi.fn(async () => ({ access_token: 'test-token' })),
    getCurrentUser: vi.fn(async () => ({
        $id: 'u-1', email: 'jo@example.com', name: 'Jo Kim', $createdAt: '2026-10-17',
    })),
    syncUserMetaDataMutation: vi.fn(async () => {}),
}));

vi.mock('../../modules/user/email-confirmation.js', () => ({
    sendWelcomeEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock('../../modules/auth/turnstile-logic.js', () => ({
    verifyTurnstileToken: vi.fn(async () => true),
}));

vi.mock('../../modules/auth/email-validation-logic.js', () => ({
    checkEmailAddress: vi.fn(async () => ({ valid: true, reason: 'ok', suggestion: '' })),
    normalizeEmail: (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : ''),
}));

import { useSignupForm } from './SignupForm.jsx';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
    const form = useSignupForm({ captcha: false });
    const click = (id, fn) => <button data-testid={id} onClick={() => fn()}>{id}</button>;
    return (
        <div>
            {click('first', () => form.setFirstName('Jo'))}
            {click('last', () => form.setLastName('Kim'))}
            {click('email', () => form.handleEmailChange('  Jo@Example.COM '))}
            {click('password', () => form.setPassword('password123'))}
            {click('submit', () => form.handleSubmit({ preventDefault() {} }))}
            <div data-testid="error">{form.error}</div>
            {/* handleSubmit holds loading true across the whole async chain
                (captcha -> email gate -> signUp -> profile write) and clears it
                only in its finally, so it is the real end-of-chain signal. */}
            <div data-testid="loading">{String(form.loading)}</div>
        </div>
    );
}

const errorText = () => container.querySelector('[data-testid="error"]').textContent;

const read = (id) => container.querySelector(`[data-testid="${id}"]`).textContent;

async function submit() {
    await act(async () => { host.render(<Harness />); });
    for (const id of ['first', 'last', 'email', 'password', 'submit']) {
        await act(async () => {
            container.querySelector(`[data-testid="${id}"]`)
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }
    // Wait for the real completion signal instead of sleeping a fixed 50ms.
    // handleSubmit sets loading true before its first await and clears it only in
    // its finally, so loading === 'false' IS the end-of-chain condition. A fixed
    // sleep is a timing assumption: it holds when the file runs alone but not
    // under the full suite's load, where the post-signUp profile write had not
    // landed yet and the call-count assertions failed intermittently. The empty
    // act first flushes setLoading(true) so the loop cannot read 'false' in the
    // gap between the click dispatch and the chain starting. Every poll still
    // flushes React through act, exactly as the single sleep did.
    await act(async () => {});
    for (let poll = 0; poll < 400; poll += 1) {
        if (read('loading') === 'false') break;
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
}

let host;
let container;

beforeEach(() => {
    insertCalls.length = 0;
    upsertOpts.length = 0;
    signUpSpy.mockReset().mockResolvedValue({
        data: { user: { id: 'u-1', email: 'jo@example.com', created_at: '2026-10-17' } },
        error: null,
    });
    appStore.setState({ pendingFriendCredits: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    host = createRoot(container);
});

afterEach(() => {
    act(() => host.unmount());
    container.remove();
});

describe('signup profile write', () => {
    it('upserts on conflict id, so the geo write cannot collide with it', async () => {
        await submit();

        expect(insertCalls.length, 'the profile row was never written').toBe(1);
        expect(upsertOpts, 'the profile write must pass onConflict options')
            .toEqual([{ onConflict: 'id' }]);
    });

    it('writes the complete profile, including the normalized email and a share code', async () => {
        await submit();
        const row = insertCalls[0];

        expect(row.email).toBe('jo@example.com');
        expect(row.first_name).toBe('Jo');
        expect(row.last_name).toBe('Kim');
        expect(row.native_language).toBeDefined();
        expect(row.account_status).toBe('active');
        expect(row.join_date).toBeTruthy();
        // A row without a share code can never be reached by share link, which
        // is exactly how the ghost rows were spotted.
        expect(row.share_code).toBeTruthy();
    });

    it('reports no error when the profile write succeeds', async () => {
        // Assert the real outcome: no failure surfaced to the user. An earlier
        // version asserted an empty local array, which could never fail and was
        // not connected to anything the hook produced.
        await submit();
        expect(errorText(), 'signup surfaced an error').toBe('');
    });
});
