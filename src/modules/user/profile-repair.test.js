// The client-side repair: saveCourseToUserProfile must never deepen a fragment
// into a permanent ghost row, and must never destroy a healthy one.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getCurrentUserMock, fetchIdentityMock } = vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
    fetchIdentityMock: vi.fn(),
}));
// A real spy, created once. Overwriting the action on the Zustand state object
// would mutate it permanently for the rest of the file.
let setCourseDataSpy = null;

vi.mock('../api/api.js', () => ({
    syncUserMetaDataMutation: vi.fn(async () => {}),
    getCurrentSession: vi.fn(async () => ({ access_token: 'test-token' })),
    getCurrentSession: vi.fn(async () => ({ access_token: 'test-token' })),
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    fetchProfileIdentityRow: (...args) => fetchIdentityMock(...args),
}));

vi.mock('../api/supabase.js', () => ({
    supabase: {
        rpc: vi.fn(async () => ({ data: 'zzzzz', error: null })),
    },
}));

import { syncUserMetaDataMutation } from '../api/api.js';
import { supabase } from '../api/supabase.js';
import { saveCourseToUserProfile, ensureCompleteProfileRow } from './user-profile.js';
import { appStore } from '../store/store.js';

const writes = () => syncUserMetaDataMutation.mock.calls.map((c) => c[0]);
const lastWrite = () => writes()[writes().length - 1];

const sessionUser = {
    $id: 'u-1',
    email: 'jo@example.com',
    name: 'Jo Kim',
    $createdAt: '2026-10-17T00:00:00Z',
    user_metadata: { native_language: 'fr' },
};

const completeRow = {
    id: 'u-1',
    email: 'jo@example.com',
    first_name: 'Jo',
    last_name: 'Kim',
    share_code: 'abcd',
    join_date: '2026-10-17T00:00:00Z',
    account_status: 'active',
    native_language: 'fr',
};

// What useUserProfile holds for a healthy account.
const healthyUserData = { ...completeRow, $id: 'u-1', display_name: 'Jo Kim' };

beforeEach(() => {
    syncUserMetaDataMutation.mockClear().mockResolvedValue(undefined);
    getCurrentUserMock.mockReset().mockResolvedValue(sessionUser);
    fetchIdentityMock.mockReset().mockResolvedValue({ row: completeRow, error: null });
    supabase.rpc.mockReset().mockResolvedValue({ data: 'zzzzz', error: null });
    appStore.setState({
        pendingFriendCredits: [],
        userData: { $id: 'u-1', email: 'jo@example.com', share_code: 'abcd' },
    });
    // Spy rather than assign: actions live on the Zustand state object, so
    // overwriting one would mutate it permanently for the rest of the file.
    if (setCourseDataSpy) setCourseDataSpy.mockClear();
    else setCourseDataSpy = vi.spyOn(appStore.getState(), 'setCourseData').mockImplementation(() => {});
});

describe('ensureCompleteProfileRow', () => {
    it('writes nothing when the row is already complete, without even reading', async () => {
        // The fast path must skip the round-trip: saveCourseToUserProfile runs
        // ahead of the preloader on every course boot. Asserting the read is NOT
        // made is the only thing guarding that.
        const result = await ensureCompleteProfileRow(healthyUserData);
        expect(result).toEqual({ confirmed: true, payload: null });
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
        expect(fetchIdentityMock, 'the fast path must not hit the network').not.toHaveBeenCalled();
        expect(getCurrentUserMock).not.toHaveBeenCalled();
    });

    it('takes the READ path for the core-data fallback, even though it has an email', async () => {
        // The fast path's safety rests on this: useUserProfile's fallback carries
        // email + join_date but never share_code or account_status, so it can
        // never be mistaken for a complete row. If those keys were ever added to
        // the fallback, this is the test that catches it.
        await ensureCompleteProfileRow({
            $id: 'u-1',
            email: 'jo@example.com',
            display_name: 'Jo Kim',
            join_date: '2026-10-17T00:00:00Z',
            auth_method: 'supabase',
            profilePictureUrl: 'pic.png',
        });
        expect(fetchIdentityMock, 'a fallback-shaped object must trigger the explicit read')
            .toHaveBeenCalledTimes(1);
    });

    it('refuses to fill a row from a DIFFERENT session user', async () => {
        // Cross-user data: the id to repair comes from userData, the identity
        // fields from a later session read.
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });
        getCurrentUserMock.mockResolvedValue({ ...sessionUser, $id: 'someone-else' });

        const result = await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' });

        expect(result).toMatchObject({ confirmed: false, reason: 'session-mismatch' });
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('heals a stale session when the read confirms a complete row', async () => {
        // userData was the core-data fallback (its own query failed earlier), but
        // the explicit read now proves the row is complete — so the session must
        // learn the share code rather than emit undefined share links.
        fetchIdentityMock.mockResolvedValue({ row: { ...completeRow, id: 'u-1' }, error: null });

        const result = await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' });

        expect(result).toMatchObject({ confirmed: true, payload: null });
        expect(setCourseDataSpy).toHaveBeenCalledTimes(1);
        expect(setCourseDataSpy.mock.calls[0][0].userData.share_code).toBe('abcd');
        // Nothing written — this was a read, not a repair.
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('inserts a complete row when none exists, and assigns a share code', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });

        const result = await ensureCompleteProfileRow({ $id: 'u-1' });

        expect(syncUserMetaDataMutation).toHaveBeenCalledTimes(1);
        const row = lastWrite();
        expect(row.email).toBe('jo@example.com');
        expect(row.share_code).toBeTruthy();
        expect(row.share_code.length).toBeGreaterThanOrEqual(4);
        expect(result.confirmed).toBe(true);
        expect(result.payload.share_code).toBe(row.share_code);
    });

    it('fills a fragment WITHOUT rotating an existing share code', async () => {
        fetchIdentityMock.mockResolvedValue({
            row: { ...completeRow, share_code: 'keepme', email: null },
            error: null,
        });

        await ensureCompleteProfileRow({ $id: 'u-1' });

        const row = lastWrite();
        expect(row.email).toBe('jo@example.com');
        expect('share_code' in row, 'an existing share code must never be overwritten').toBe(false);
    });

    it('does NOTHING when the read fails — a failed read is not a missing row', async () => {
        // The signal this replaced (the core-data fallback's missing share_code)
        // is also produced by a transient error, so a healthy profile would be
        // rewritten on every network blip.
        fetchIdentityMock.mockResolvedValue({ row: null, error: { message: 'PGRST301' } });

        expect(await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' }))
            .toMatchObject({ confirmed: false, payload: null });
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('merges a repaired share code into the store so this session can use it', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });
        await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' });

        expect(setCourseDataSpy).toHaveBeenCalledTimes(1);
        const merged = setCourseDataSpy.mock.calls[0][0].userData;
        expect(merged.share_code).toBeTruthy();
        expect(merged.shareCode).toBe(merged.share_code);
    });

    it('writes nothing for a guest', async () => {
        expect(await ensureCompleteProfileRow({ $id: 'guest' }))
            .toMatchObject({ confirmed: false, payload: null });
        expect(fetchIdentityMock).not.toHaveBeenCalled();
    });
});

describe('saveCourseToUserProfile', () => {
    it('writes only the progress when the profile is already complete', async () => {
        await saveCourseToUserProfile('model', healthyUserData);
        const all = writes();
        expect(all.length).toBe(1);
        expect(all[0].course_progress).toBeTruthy();
    });

    it('creates the identity BEFORE writing progress for a profile-less account', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });

        await saveCourseToUserProfile('model', { $id: 'u-1', email: 'jo@example.com' });

        const all = writes();
        expect(all.length, 'expected an identity write and a progress write').toBe(2);
        expect(all[0].share_code, 'first write must carry identity').toBeTruthy();
        expect(all[1].course_progress).toBeTruthy();
    });

    it('never lets the FIRST write for a profile-less account be identity-less', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });
        await saveCourseToUserProfile('model', { $id: 'u-1', email: 'jo@example.com' });

        const all = writes();
        const firstIdentity = all.findIndex((r) => Boolean(r.email || r.share_code));
        const firstProgress = all.findIndex((r) => Boolean(r.course_progress));
        expect(firstIdentity).toBeGreaterThanOrEqual(0);
        expect(firstIdentity, 'progress was written before any identity').toBeLessThan(firstProgress);
    });

    it('ABORTS the progress write when the repair fails, rather than fabricating a row', async () => {
        // Regression: the guard exists precisely to stop the progress upsert from
        // creating a NULL-email fragment, so a failed repair must stop the flow.
        syncUserMetaDataMutation.mockRejectedValueOnce(new Error('network'));
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });

        const result = await saveCourseToUserProfile('model', { $id: 'u-1' });

        expect(result, 'a failed repair must not report success').toBeNull();
        // Exactly one write: the failed repair. No progress write followed it.
        expect(writes().length).toBe(1);
        expect(writes()[0].course_progress).toBeUndefined();
    });

    it('ABORTS the progress write when the profile row cannot be confirmed', async () => {
        // Read failed -> we do not know whether the row exists, and the progress
        // write is what would create a fragment.
        fetchIdentityMock.mockResolvedValue({ row: null, error: { message: 'boom' } });

        const result = await saveCourseToUserProfile('model', { $id: 'u-1', email: 'jo@example.com' });

        expect(result).toBeNull();
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('keeps a ghost row from deadlocking: every bootstrap still makes progress', async () => {
        // Regression: a pre-009 ghost row has a NULL share_code. When the repair
        // refused to fill it, the row stayed "incomplete" forever, so the caller
        // aborted EVERY later progress write and the account never got a share
        // code. After one repair the row must be complete.
        const ghostRow = {
            id: 'u-1', email: null, first_name: null, last_name: null,
            share_code: null, join_date: null, account_status: null, native_language: null,
        };
        fetchIdentityMock.mockResolvedValue({ row: ghostRow, error: null });

        await saveCourseToUserProfile('model', { $id: 'u-1', email: 'jo@example.com' });

        const repaired = writes()[0];
        expect(repaired.share_code, 'the repair must fill the missing share code').toBeTruthy();
        expect(repaired.email).toBe('jo@example.com');

        // Bootstrap 2: the row is now complete, so the fast path confirms it and
        // the progress write proceeds instead of being blocked forever.
        syncUserMetaDataMutation.mockClear();
        const completeNow = { ...ghostRow, ...repaired };
        fetchIdentityMock.mockResolvedValue({ row: completeNow, error: null });

        const second = await saveCourseToUserProfile('friend', {
            $id: 'u-1', email: completeNow.email, share_code: completeNow.share_code,
            join_date: completeNow.join_date, account_status: completeNow.account_status,
        });

        expect(second, 'later course bootstraps must not be blocked').toBe(true);
        expect(writes()).toHaveLength(1);
        expect(writes()[0].course_progress).toBeTruthy();
    });

    it('falls back to the DB trigger when the mint RPC fails', async () => {
        // Row is complete except for a NULL share code. RPC fails, so the
        // repair must force a write with share_code: null (the trigger's fill
        // signal) and read the generated code back.
        const codeMissing = { ...completeRow, share_code: null };
        fetchIdentityMock
            .mockResolvedValueOnce({ row: codeMissing, error: null }) // identity read
            .mockResolvedValueOnce({ row: { ...codeMissing, share_code: 'trg01' }, error: null }); // read-back
        supabase.rpc.mockResolvedValue({ data: null, error: new Error('down') });

        const result = await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' });

        expect(result.confirmed).toBe(true);
        expect(writes()[0]).toMatchObject({ id: 'u-1', share_code: null });
        expect(fetchIdentityMock).toHaveBeenCalledTimes(2);
        const merged = setCourseDataSpy.mock.calls
            .map((c) => c[0].userData)
            .find((u) => u && u.share_code === 'trg01');
        expect(merged, 'the read-back code must reach the store').toBeTruthy();
    });

    it('leaves guests and already-initialised courses alone', async () => {
        expect(await saveCourseToUserProfile('model', { $id: 'guest' })).toBe(true);
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();

        syncUserMetaDataMutation.mockClear();
        fetchIdentityMock.mockClear();
        await saveCourseToUserProfile('model', {
            ...healthyUserData,
            course_progress: JSON.stringify({ model: { current_lesson: 'm-g', lesson_timestamp: 'x' } }),
        });
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });
});
