// Guards the statistics model: the five stats the profile/home table shows,
// the Bootstrap icon that carries each one, the value derivation (the streak
// is DERIVED from completion dates, the friend count is the friends array
// length) and the home dashboard's source selection (profile row for a
// registered learner, local activity metrics for a guest).
import { describe, it, expect } from 'vitest';
import {
    PROFILE_STATS,
    buildStatsView,
    buildProfileStats,
    buildHomeStats,
    homeStatsValues,
    profileStatsValues,
    isRegisteredProfile,
} from './profile-stats-logic.js';

const today = () => new Date().toLocaleDateString('en-CA');
const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA');
};

describe('PROFILE_STATS definitions', () => {
    it('lists exactly the five statistics in display order', () => {
        expect(PROFILE_STATS.map((s) => s.id)).toEqual([
            'streak', 'lessons', 'friends', 'referrals', 'daysActive',
        ]);
    });

    it('gives every statistic a Bootstrap icon', () => {
        for (const stat of PROFILE_STATS) {
            expect(stat.icon, stat.id).toMatch(/^bi-[a-z-]+$/);
        }
    });

    it('uses the flame for the streak and a distinct icon for each other stat', () => {
        expect(PROFILE_STATS.find((s) => s.id === 'streak').icon).toBe('bi-fire');
        const icons = PROFILE_STATS.map((s) => s.icon);
        expect(new Set(icons).size).toBe(icons.length);
    });

    it('labels every statistic in plain English, without a strings-table key', () => {
        expect(PROFILE_STATS.map((s) => s.label)).toEqual([
            'Streak', 'Lessons', 'Friends', 'Referrals', 'Days Active',
        ]);
        for (const stat of PROFILE_STATS) {
            expect(stat.labelKey, stat.id).toBeUndefined();
        }
    });

    it('links ONLY the friends stat, to the friends page', () => {
        const linked = PROFILE_STATS.filter((s) => s.href);
        expect(linked.map((s) => s.id)).toEqual(['friends']);
        expect(linked[0].href).toBe('/friends');
    });
});

describe('profileStatsValues', () => {
    it('derives the streak from completed dates, never from a stored field', () => {
        const values = profileStatsValues({
            completed_dates: [daysAgo(1), today()],
            current_streak: 99,
        });
        expect(values.streak).toBe(2);
    });

    it('counts friends from the array and reads lessons/referrals/days', () => {
        const values = profileStatsValues({
            completed_dates: [today(), daysAgo(1), daysAgo(2)],
            lessons_completed: 12,
            referrals: 3,
            friends: [{ id: 'a' }, { id: 'b' }],
        });
        expect(values).toMatchObject({ lessons: 12, friends: 2, referrals: 3, daysActive: 3 });
    });

    it('tolerates a missing or partial profile', () => {
        expect(profileStatsValues(undefined)).toEqual({
            streak: 0, lessons: 0, friends: 0, referrals: 0, daysActive: 0,
        });
    });
});

describe('buildStatsView', () => {
    it('pairs each definition with its value in order', () => {
        const view = buildStatsView({
            streak: 4, lessons: 9, friends: 2, referrals: 1, daysActive: 7,
        });
        expect(view.map((s) => [s.id, s.value])).toEqual([
            ['streak', 4], ['lessons', 9], ['friends', 2], ['referrals', 1], ['daysActive', 7],
        ]);
        expect(view[0].icon).toBe('bi-fire');
        expect(view[0].label).toBe('Streak');
    });

    it('clamps anything that is not a positive count to 0', () => {
        const view = buildStatsView({
            streak: -3, lessons: 'nope', friends: null, referrals: undefined, daysActive: 2.9,
        });
        expect(view.map((s) => s.value)).toEqual([0, 0, 0, 0, 2]);
    });
});

describe('buildHomeStats source selection', () => {
    const activity = { streak: 5, lessons: 8, daysActive: 11 };

    it('treats a real profile as the authoritative source', () => {
        const stats = buildHomeStats({
            profile: {
                $id: 'u1',
                completed_dates: [today()],
                lessons_completed: 2,
                friends: [{ id: 'f' }],
                referrals: 1,
            },
            activity,
        });
        expect(stats.map((s) => s.value)).toEqual([1, 2, 1, 1, 1]);
    });

    it('uses the local activity metrics for a guest stub', () => {
        expect(isRegisteredProfile({ $id: 'guest' })).toBe(false);
        const stats = buildHomeStats({ profile: { $id: 'guest', completed_dates: [] }, activity });
        expect(stats.map((s) => s.value)).toEqual([5, 8, 0, 0, 11]);
    });

    it('uses the local activity metrics before the profile loads', () => {
        expect(homeStatsValues({ profile: undefined, activity }).streak).toBe(5);
        const stats = buildHomeStats({ activity });
        expect(stats.map((s) => s.id)).toEqual(PROFILE_STATS.map((s) => s.id));
    });
});

describe('buildProfileStats', () => {
    it('builds the five-row table from a profile row', () => {
        const stats = buildProfileStats({
            completed_dates: [today(), daysAgo(1), daysAgo(2)],
            lessons_completed: 6,
            friends: [{ id: 'a' }],
            referrals: 4,
        });
        expect(stats).toHaveLength(5);
        expect(stats.map((s) => s.value)).toEqual([3, 6, 1, 4, 3]);
    });
});
