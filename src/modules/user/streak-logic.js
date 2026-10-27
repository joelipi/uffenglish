// Pure streak arithmetic, extracted from user-profile.js so modules that only
// need the number (the profile/home statistics) do not drag the API client and
// the store into their import graph (and, with them, Supabase/PostHog).

/**
 * Restored from your original file: Calculates streaks
 *
 * A streak survives the day after the last lesson was completed (so the
 * learner does not "lose" it until a full day is skipped), and counts
 * consecutive local calendar days backwards from today (or yesterday).
 * Dates are the app's local `en-CA` day strings (`YYYY-MM-DD`).
 */
export function calculateCurrentStreak(completedDatesArray) {
    if (!Array.isArray(completedDatesArray) || completedDatesArray.length === 0) return 0;
    const localToday = new Date().toLocaleDateString('en-CA');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const localYesterday = yesterday.toLocaleDateString('en-CA');

    if (!completedDatesArray.includes(localToday) && !completedDatesArray.includes(localYesterday)) return 0;

    let streak = 0;
    let checkDate = new Date();
    if (!completedDatesArray.includes(localToday)) checkDate.setDate(checkDate.getDate() - 1);

    while (completedDatesArray.includes(checkDate.toLocaleDateString('en-CA'))) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
}
