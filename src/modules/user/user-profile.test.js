import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api/api.js', () => ({
    syncUserMetaDataMutation: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => null),
}));

import { syncUserMetaDataMutation } from '../api/api.js';
import { saveLessonProgress } from './user-profile.js';
import { appStore } from '../store/store.js';

function lastMeta() {
    const calls = syncUserMetaDataMutation.mock.calls;
    return calls[calls.length - 1]?.[0];
}

describe('saveLessonProgress lesson count', () => {
    beforeEach(() => {
        syncUserMetaDataMutation.mockClear();
        appStore.setState({
            lessonsCompleted: 0,
            countedLessons: [],
            activeLessonId: null,
            lessonScores: '{}',
            currentLessonTimestamp: null,
            userData: null,
        });
    });

    it('increments the count for a terminal lesson (no nextLessonId, the a/ case)', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0 };

        const result = await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true,
            incrementCount: true,
            completedLessonId: 'a',
        });

        expect(result.lessonsCompleted).toBe(1);
        expect(lastMeta().lessons_completed).toBe(1);
        expect(lastMeta().counted_lessons).toEqual(['wouldyourather_a']);
    });

    it('counts each completed lesson once when a and b are both completed', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0 };

        await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });
        const second = await saveLessonProgress('wouldyourather', 'b', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'b',
        });

        expect(second.lessonsCompleted).toBe(2);
        expect(appStore.getState().lessonsCompleted).toBe(2);
        expect(appStore.getState().countedLessons).toEqual(['wouldyourather_a', 'wouldyourather_b']);
    });

    it('does not double-count the same lesson (reload / retry / both persistence hooks)', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0 };

        await saveLessonProgress('model', 'm-a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'm-g',
        });
        const replay = await saveLessonProgress('model', 'm-a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'm-g',
        });

        expect(replay.lessonsCompleted).toBe(1);
        expect(appStore.getState().lessonsCompleted).toBe(1);
    });

    it('does not increment when incrementCount is not requested (loadNextLesson path)', async () => {
        const userData = { $id: 'user-1', lessons_completed: 3 };

        const result = await saveLessonProgress('model', 'm-a', userData, {});

        expect(result.lessonsCompleted).toBe(0);
        expect(lastMeta().lessons_completed).toBeUndefined();
        expect(lastMeta().counted_lessons).toBeUndefined();
        expect(appStore.getState().lessonsCompleted).toBe(0);
    });

    it('baselines off the store so a stale userData still advances the count', async () => {
        appStore.setState({ lessonsCompleted: 5 });
        const userData = { $id: 'user-1', lessons_completed: 0 };

        const result = await saveLessonProgress('model', 'm-a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'm-g',
        });

        expect(result.lessonsCompleted).toBe(6);
        expect(lastMeta().lessons_completed).toBe(6);
    });

    it('falls back to currentLessonId when completedLessonId is absent', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0 };

        const result = await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, currentLessonId: 'a',
        });

        expect(result.lessonsCompleted).toBe(1);
        expect(lastMeta().counted_lessons).toEqual(['wouldyourather_a']);
    });
});
