import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api/api.js', () => ({
    syncUserMetaDataMutation: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => null),
}));

import { syncUserMetaDataMutation } from '../api/api.js';
import { saveLessonProgress, calculateCurrentStreak } from './user-profile.js';
import { appStore } from '../store/store.js';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const daysAgoStr = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA');
};

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

    it('counts a repeated completion again — re-doing a lesson with friends earns credit', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0 };

        await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });
        const repeat = await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });

        expect(repeat.lessonsCompleted).toBe(2);
        expect(appStore.getState().lessonsCompleted).toBe(2);
        expect(lastMeta().lessons_completed).toBe(2);
        // The unique set still holds the lesson only once.
        expect(lastMeta().counted_lessons).toEqual(['wouldyourather_a']);
        expect(appStore.getState().countedLessons).toEqual(['wouldyourather_a']);
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

    it('advances past a re-fetched userData object (the store keeps the in-session count)', async () => {
        const beforeRefetch = { $id: 'user-1', lessons_completed: 0 };
        await saveLessonProgress('wouldyourather', 'a', beforeRefetch, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });

        // The invalidation in syncUserMetaDataMutation replaces state.userData
        // with a fresh object; the store still carries the in-session count.
        const afterRefetch = { $id: 'user-1', lessons_completed: 0 };
        const second = await saveLessonProgress('wouldyourather', 'b', afterRefetch, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'b',
        });

        expect(second.lessonsCompleted).toBe(2);
        expect(lastMeta().lessons_completed).toBe(2);
    });

    it('appends today to the date ledger once per day, never duplicating', async () => {
        const userData = { $id: 'user-1', lessons_completed: 0, completed_dates: [] };

        const first = await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });
        const second = await saveLessonProgress('wouldyourather', 'b', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'b',
        });

        expect(first.newDayCount).toBe(1);
        expect(first.dayCountIncremented).toBe(true);
        expect(second.dayCountIncremented).toBe(false);
        expect(second.newDayCount).toBe(1);
        // First save writes the day; the second same-day save sends no date
        // payload at all (no rewrite, no duplicate).
        expect(syncUserMetaDataMutation.mock.calls[0][0].completed_dates).toEqual([todayStr()]);
        expect('completed_dates' in lastMeta()).toBe(false);
        // The in-session object stays in sync so a later save in the same
        // session baselines off the written ledger, not a stale empty one.
        expect(userData.completed_dates).toEqual([todayStr()]);
    });

    it('extends an existing ledger without rewriting history', async () => {
        const userData = { $id: 'user-1', lessons_completed: 4, completed_dates: [daysAgoStr(1)] };

        const result = await saveLessonProgress('wouldyourather', 'a', userData, {
            updateUserMeta: true, incrementCount: true, completedLessonId: 'a',
        });

        expect(result.newDayCount).toBe(2);
        expect(result.newStreak).toBe(2);
        expect(lastMeta().completed_dates).toEqual([daysAgoStr(1), todayStr()]);
    });
});

describe('calculateCurrentStreak', () => {
    it('returns 0 for empty, missing, or non-array ledgers', () => {
        expect(calculateCurrentStreak([])).toBe(0);
        expect(calculateCurrentStreak(null)).toBe(0);
        expect(calculateCurrentStreak(undefined)).toBe(0);
        expect(calculateCurrentStreak('2026-01-01')).toBe(0);
    });

    it('returns 1 for today alone (first day, streak starts, never stuck at 0)', () => {
        expect(calculateCurrentStreak([todayStr()])).toBe(1);
    });

    it('counts consecutive days ending today', () => {
        expect(calculateCurrentStreak([daysAgoStr(2), daysAgoStr(1), todayStr()])).toBe(3);
    });

    it('counts a streak ending yesterday (today not done yet)', () => {
        expect(calculateCurrentStreak([daysAgoStr(1)]).valueOf()).toBe(1);
        expect(calculateCurrentStreak([daysAgoStr(2), daysAgoStr(1)])).toBe(2);
    });

    it('returns 0 when neither today nor yesterday is present (streak broken)', () => {
        expect(calculateCurrentStreak([daysAgoStr(2)])).toBe(0);
        expect(calculateCurrentStreak([daysAgoStr(5), daysAgoStr(4)])).toBe(0);
    });

    it('stops at the gap (today plus a non-consecutive older day)', () => {
        expect(calculateCurrentStreak([daysAgoStr(3), todayStr()])).toBe(1);
    });
});
