// The client-side repair: saveCourseToUserProfile must never deepen a fragment
// into a permanent ghost row, and must never destroy a healthy one.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getCurrentUserMock, fetchIdentityMock, setCourseDataSpy } = vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
    fetchIdentityMock: vi.fn(),
    setCourseDataSpy: vi.fn(),
}));

vi.mock('../api/api.js', () => ({
    syncUserMetaDataMutation: vi.fn(async () => {}),
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    fetchProfileIdentityRow: (...args) => fetchIdentityMock(...args),
}));

import { syncUserMetaDataMutation } from '../api/api.js';
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
    setCourseDataSpy.mockClear();
    appStore.setState({
        pendingFriendCredits: [],
        userData: { $id: 'u-1', email: 'jo@example.com', share_code: 'abcd' },
    });
    // Spy on setCourseData so we can see the store merge without a React render.
    appStore.getState().setCourseData = setCourseDataSpy;
});

describe('ensureCompleteProfileRow', () => {
    it('writes nothing when the row is already complete', async () => {
        expect(await ensureCompleteProfileRow(healthyUserData)).toBeNull();
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
        // The read is the only cost on this path.
        expect(getCurrentUserMock).not.toHaveBeenCalled();
    });

    it('inserts a complete row when none exists, and assigns a share code', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });

        const result = await ensureCompleteProfileRow({ $id: 'u-1' });

        expect(syncUserMetaDataMutation).toHaveBeenCalledTimes(1);
        const row = lastWrite();
        expect(row.email).toBe('jo@example.com');
        expect(row.share_code).toBeTruthy();
        expect(row.share_code.length).toBeGreaterThanOrEqual(4);
        expect(result.share_code).toBe(row.share_code);
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

        expect(await ensureCompleteProfileRow({ $id: 'u-1', email: 'jo@example.com' })).toBeNull();
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('merges a repaired share code into the store so this session can use it', async () => {
        fetchIdentityMock.mockResolvedValue({ row: null, error: null });
        await ensureCompleteProfileRow({ $id: 'u-1' });

        expect(setCourseDataSpy).toHaveBeenCalledTimes(1);
        const merged = setCourseDataSpy.mock.calls[0][0].userData;
        expect(merged.share_code).toBeTruthy();
        expect(merged.shareCode).toBe(merged.share_code);
    });

    it('writes nothing for a guest', async () => {
        expect(await ensureCompleteProfileRow({ $id: 'guest' })).toBeNull();
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
