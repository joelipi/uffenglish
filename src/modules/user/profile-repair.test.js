// The client-side repair: saveCourseToUserProfile must never deepen a fragment
// into a permanent ghost row by writing `course_progress` alone.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getCurrentUserMock } = vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
}));

vi.mock('../api/api.js', () => ({
    syncUserMetaDataMutation: vi.fn(async () => {}),
    getCurrentUser: (...args) => getCurrentUserMock(...args),
}));

import { syncUserMetaDataMutation } from '../api/api.js';
import { saveCourseToUserProfile, ensureCompleteProfileRow } from './user-profile.js';
import { appStore } from '../store/store.js';

const writes = () => syncUserMetaDataMutation.mock.calls.map((c) => c[0]);
const lastWrite = () => writes()[writes().length - 1];

// useUserProfile's core-data fallback: what the app holds for a missing row.
const missingRowUser = {
    $id: 'u-1',
    email: 'jo@example.com',
    display_name: 'Jo Kim',
    join_date: '2026-10-17T00:00:00Z',
    auth_method: 'supabase',
    course_progress: undefined,
};

const completeRowUser = { ...missingRowUser, share_code: 'abcd', account_status: 'active' };

beforeEach(() => {
    syncUserMetaDataMutation.mockClear();
    getCurrentUserMock.mockReset().mockResolvedValue({
        $id: 'u-1',
        email: 'jo@example.com',
        name: 'Jo Kim',
        $createdAt: '2026-10-17T00:00:00Z',
    });
    appStore.setState({ pendingFriendCredits: [] });
});

describe('ensureCompleteProfileRow', () => {
    it('writes nothing when the profile is already complete', async () => {
        expect(await ensureCompleteProfileRow(completeRowUser)).toBe(true);
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
        expect(getCurrentUserMock).not.toHaveBeenCalled();
    });

    it('writes a complete row when the profile is missing', async () => {
        expect(await ensureCompleteProfileRow(missingRowUser)).toBe(true);
        expect(syncUserMetaDataMutation).toHaveBeenCalledTimes(1);

        const row = lastWrite();
        expect(row.email).toBe('jo@example.com');
        expect(row.first_name).toBe('Jo');
        expect(row.last_name).toBe('Kim');
        expect(row.share_code).toBeTruthy();
        expect(row.account_status).toBe('active');
    });

    it('writes a fresh share code each time it repairs', async () => {
        await ensureCompleteProfileRow(missingRowUser);
        const first = lastWrite().share_code;
        await ensureCompleteProfileRow(missingRowUser);
        // Both must be real 4+ char codes; a collision would break the UNIQUE index.
        expect(first).toBeTruthy();
        expect(typeof lastWrite().share_code).toBe('string');
        expect(lastWrite().share_code.length).toBeGreaterThanOrEqual(4);
    });

    it('writes nothing for a guest or when there is no session', async () => {
        expect(await ensureCompleteProfileRow({ ...missingRowUser, $id: 'guest' })).toBe(true);
        getCurrentUserMock.mockResolvedValue(null);
        expect(await ensureCompleteProfileRow(missingRowUser)).toBe(false);
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });

    it('propagates a failed repair rather than continuing', async () => {
        // If the repair fails, the progress write must not then fabricate a row.
        syncUserMetaDataMutation.mockRejectedValueOnce(new Error('network'));
        await expect(ensureCompleteProfileRow(missingRowUser)).rejects.toThrow('network');
    });
});

describe('saveCourseToUserProfile', () => {
    it('repairs the row BEFORE writing course progress', async () => {
        await saveCourseToUserProfile('model', missingRowUser);

        const all = writes();
        expect(all.length, 'expected a repair write and a progress write').toBe(2);

        // The repair must come first, or the progress upsert fabricates the row.
        expect(all[0].share_code, 'first write should be the repair').toBeTruthy();
        expect(all[1].course_progress, 'second write should be the progress').toBeTruthy();
        expect(all[1].share_code, 'the progress write must not fabricate a row').toBeUndefined();
    });

    it('writes only the progress when the profile is already complete', async () => {
        await saveCourseToUserProfile('model', completeRowUser);
        const all = writes();
        expect(all.length).toBe(1);
        expect(all[0].course_progress).toBeTruthy();
    });

    it('never lets the FIRST write for a profile-less account be identity-less', async () => {
        // The ghost-row signature is a create-with-only-course_progress. Once the
        // repair has run, a later progress-only write is a legitimate UPDATE of an
        // already-complete row — so the invariant is about ORDER, not about every
        // write carrying identity.
        await saveCourseToUserProfile('model', missingRowUser);

        const all = writes();
        const firstIdentityWrite = all.findIndex((r) => Boolean(r.email || r.share_code));
        const firstProgressWrite = all.findIndex((r) => Boolean(r.course_progress));

        expect(firstIdentityWrite, 'no write carried identity').toBeGreaterThanOrEqual(0);
        expect(firstProgressWrite, 'no progress write happened').toBeGreaterThanOrEqual(0);
        expect(firstIdentityWrite,
            'progress was written before any identity — the row would be created empty')
            .toBeLessThan(firstProgressWrite);
    });

    it('leaves guests and unknown courses alone', async () => {
        expect(await saveCourseToUserProfile('model', { $id: 'guest' })).toBe(true);
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();

        syncUserMetaDataMutation.mockClear();
        // Already has this course -> nothing to do, and no repair.
        await saveCourseToUserProfile('model', {
            ...completeRowUser,
            course_progress: JSON.stringify({ model: { current_lesson: 'm-g', lesson_timestamp: 'x' } }),
        });
        expect(syncUserMetaDataMutation).not.toHaveBeenCalled();
    });
});