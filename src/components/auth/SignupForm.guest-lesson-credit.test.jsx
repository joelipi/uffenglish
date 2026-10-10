// Proves the guest → signup path on the success screen persists the just-completed
// lesson: before this, the guest's completion lived only in the Zustand store and
// was discarded by the bootstrap that seeds the store from the new profile row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Tracks every insert, tagged with the table it targeted.
const { insertCalls, setQueryDataSpy } = vi.hoisted(() => ({
    insertCalls: [],
    setQueryDataSpy: vi.fn(),
}));

vi.mock('../../modules/api/supabase.js', () => ({
    supabase: {
        auth: {
            signUp: async () => ({
                data: { user: { id: 'new-user-1', email: 'jo@example.com', created_at: '2026-10-10' } },
                error: null,
            }),
        },
        from: (table) => ({
            insert: (row) => {
                insertCalls.push({ table, row });
                return Promise.resolve({ error: null });
            },
            upsert: () => Promise.resolve({ error: null }),
        }),
    },
}));

vi.mock('../../modules/api/api.js', () => ({
    queryClient: { setQueryData: setQueryDataSpy, invalidateQueries: vi.fn() },
    fetchGeoInfo: vi.fn(async () => ({ ip: '1.2.3.4' })),
}));

vi.mock('../../modules/user/email-confirmation.js', () => ({
    sendWelcomeEmail: vi.fn(async () => ({ sent: true })),
}));

import { useSignupForm } from './SignupForm.jsx';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Minimal harness — the repo tests components with react-dom/client in jsdom.
function Harness() {
    const form = useSignupForm({ nativeLanguage: 'ES' });
    const click = (id, fn) => (
        <button data-testid={id} onClick={() => fn()}>{id}</button>
    );
    return (
        <div>
            {click('first', () => form.setFirstName('Jo'))}
            {click('last', () => form.setLastName('Kim'))}
            {click('email', () => form.setEmail('jo@example.com'))}
            {click('password', () => form.setPassword('password123'))}
            {click('submit', () => form.handleSubmit({ preventDefault() {} }))}
        </div>
    );
}

async function submitSignup() {
    await act(async () => { host.render(<Harness />); });
    for (const id of ['first', 'last', 'email', 'password', 'submit']) {
        await act(async () => {
            container.querySelector(`[data-testid="${id}"]`)
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }
    // The submit handler is fully async (auth + profile insert); let its
    // microtasks drain before asserting on what it wrote.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

// The signup profile row is identified by the form data; other inserts in the
// module graph (welcome-email bookkeeping) are transient.
const insertedRow = () => {
    const profile = insertCalls.find((c) => c.row && 'first_name' in c.row);
    expect(profile, 'profile insert').toBeTruthy();
    return profile.row;
};

let host;
let container;

beforeEach(() => {
    insertCalls.length = 0;
    setQueryDataSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    host = createRoot(container);
});

afterEach(() => {
    act(() => host.unmount());
    container.remove();
});

describe('signup credits the lesson a guest just completed', () => {
    it('writes lessons_completed = 1 and counted_lessons for the success-step lesson', async () => {
        appStore.setState({ courseId: 'wouldyourather', successLessonId: 'a' });
        insertCalls.length = 0;

        await submitSignup();

        const row = insertedRow();
        expect(row.id).toBe('new-user-1');
        expect(row.lessons_completed).toBe(1);
        expect(row.counted_lessons).toEqual(['wouldyourather_a']);
        // The client-side profile mirrors the row.
        const profile = setQueryDataSpy.mock.calls.at(-1)[1];
        expect(profile.lessons_completed).toBe(1);
        expect(profile.counted_lessons).toEqual(['wouldyourather_a']);
    });

    it('credits the exact lesson on the success screen, keyed by courseId', async () => {
        appStore.setState({ courseId: 'friendchain', successLessonId: 'c' });
        insertCalls.length = 0;

        await submitSignup();

        const row = insertedRow();
        expect(row.lessons_completed).toBe(1);
        expect(row.counted_lessons).toEqual(['friendchain_c']);
    });

    it('writes no lesson columns when signing up away from a success screen', async () => {
        appStore.setState({ courseId: 'wouldyourather', successLessonId: null });
        insertCalls.length = 0;

        await submitSignup();

        const row = insertedRow();
        expect('lessons_completed' in row).toBe(false);
        expect('counted_lessons' in row).toBe(false);
        const profile = setQueryDataSpy.mock.calls.at(-1)[1];
        expect('lessons_completed' in profile).toBe(false);
    });

    it('never credits a lesson when no course is loaded', async () => {
        appStore.setState({ courseId: null, successLessonId: 'a' });
        insertCalls.length = 0;

        await submitSignup();

        const row = insertedRow();
        expect('lessons_completed' in row).toBe(false);
    });
});
