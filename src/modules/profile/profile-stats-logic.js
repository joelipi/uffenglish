// The statistics table's rules: which stats exist, their icon and label, how
// each value is derived, and how the home dashboard picks its source.
//
// Pure module — no React, no DOM, no store — so the profile, the public
// share-code page and the /home dashboard all render ONE definition and the
// values can be unit-tested directly.
import { calculateCurrentStreak } from '../user/streak-logic.js';

/**
 * Ordered stat definitions. `id` is also the value key and the test hook.
 * `label` is deliberately plain English (not a strings-table key): the table is
 * a single-line-per-stat strip where a translated label would not fit, and the
 * user asked for these to stay untranslated. `icon` is a Bootstrap Icons class
 * (the set the app already ships), chosen to read as the stat's meaning at a
 * glance: a flame for the daily streak, a graduation cap for lessons, people
 * for friends, a person-plus for referrals, and a calendar-check for active
 * days. `href` (only the friends stat) makes that tile a quiet link.
 */
export const PROFILE_STATS = [
    { id: 'streak', icon: 'bi-fire', label: 'Streak' },
    { id: 'lessons', icon: 'bi-mortarboard-fill', label: 'Lessons' },
    { id: 'friends', icon: 'bi-people-fill', label: 'Friends', href: '/friends' },
    { id: 'referrals', icon: 'bi-person-plus-fill', label: 'Referrals' },
    { id: 'daysActive', icon: 'bi-calendar-check-fill', label: 'Days Active' },
];

/** Clamp anything the profile/store hands over to a non-negative integer. */
function toCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function datesOf(profile) {
    return Array.isArray(profile?.completed_dates) ? profile.completed_dates : [];
}

/** A guest stub is not an account, so its (empty) counters are not the truth. */
export function isRegisteredProfile(profile) {
    return Boolean(profile && profile.$id && profile.$id !== 'guest');
}

/**
 * Values read off a profile row. The streak is DERIVED from the completion
 * dates (never a stored field, which drifts), and the friend count is the
 * length of the row's friends array.
 */
export function profileStatsValues(profile) {
    const completedDates = datesOf(profile);
    return {
        streak: calculateCurrentStreak(completedDates),
        lessons: toCount(profile?.lessons_completed),
        friends: Array.isArray(profile?.friends) ? profile.friends.length : 0,
        referrals: toCount(profile?.referrals),
        daysActive: completedDates.length,
    };
}

/**
 * Values for the /home dashboard. A registered learner reads the profile row
 * (the server's counters are authoritative); a guest reads the local activity
 * metrics the lesson flow already tracks in the store, because the guest
 * profile is a stub with empty arrays and zero counters.
 */
export function homeStatsValues({ profile, activity = {} } = {}) {
    if (isRegisteredProfile(profile)) return profileStatsValues(profile);
    return {
        streak: activity.streak,
        lessons: activity.lessons,
        friends: 0,
        referrals: 0,
        daysActive: activity.daysActive,
    };
}

/** Turn value bags into the renderable, ordered stat list. */
export function buildStatsView(values = {}) {
    return PROFILE_STATS.map((stat) => ({
        ...stat,
        value: toCount(values[stat.id]),
    }));
}

/** The statistics table for a profile page (own or public). */
export function buildProfileStats(profile) {
    return buildStatsView(profileStatsValues(profile));
}

/** The statistics table for the /home dashboard. */
export function buildHomeStats({ profile, activity } = {}) {
    return buildStatsView(homeStatsValues({ profile, activity }));
}
