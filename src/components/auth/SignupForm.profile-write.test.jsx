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
import { waitForSignupChain } from './signup-chain-wait.js';

const { insertCalls, upsertOpts, signUpSpy, emailSpy, rpcSpy } = vi.hoisted(() => ({
    insertCalls: [],
    upsertOpts: [],
    signUpSpy: vi.fn(),
    emailSpy: vi.fn(async () => ({ valid: true, reason: 'ok', suggestion: '' })),
    rpcSpy: vi.fn(async () => ({ data: 'zzzzz', error: null })),
}));

vi.mock('../../modules/api/supabase.js', () => ({
    supabase: {
        auth: { signUp: (...args) => signUpSpy(...args) },
        rpc: (...args) => rpcSpy(...args),
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
    checkEmailAddress: emailSpy,
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
    // `loading` clearing is the end-of-chain signal; the helper throws rather
    // than falling through, so a hung chain fails here instead of surfacing as a
    // confusing downstream assertion failure.
    await waitForSignupChain(() => read('loading') === 'false');
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
    emailSpy.mockReset().mockResolvedValue({ valid: true, reason: 'ok', suggestion: '' });
    rpcSpy.mockReset().mockResolvedValue({ data: 'zzzzz', error: null });
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
        expect(row.share_code).toBe('zzzzz'); // minted server-side via generate_share_code()
    });

    it('reports no error when the profile write succeeds', async () => {
        // Assert the real outcome: no failure surfaced to the user. An earlier
        // version asserted an empty local array, which could never fail and was
        // not connected to anything the hook produced.
        await submit();
        expect(errorText(), 'signup surfaced an error').toBe('');
    });

    it('falls back to a local code when the RPC is unavailable', async () => {
        rpcSpy.mockReset().mockResolvedValue({ data: null, error: new Error('down') });
        await submit();
        expect(errorText(), 'signup surfaced an error').toBe('');
        expect(insertCalls[0].share_code, 'client must still write a usable code').toBeTruthy();
        expect(insertCalls[0].share_code.length).toBe(5);
    });
});
