// modules/user/profile-repair-logic.js — pure rules for repairing an incomplete
// `user_profiles` row. No React, no DOM, no Supabase.
//
// WHY THIS EXISTS
//
// Every client write to `user_profiles` goes through an upsert with
// `onConflict: 'id'`. PostgREST resolves that to a plain INSERT when no row
// exists, so the first write against an account that has no profile FABRICATED
// one containing only the columns it happened to supply. `saveCourseToUserProfile`
// supplies just `course_progress`, which produced the ghost rows seen in the
// database: `email`, `first_name`, `last_name`, `join_date` and `share_code` all
// NULL, with only `course_progress` set. Such an account renders like an
// anonymous visitor, has no share code, and silently fails to persist progress.
//
// migration 009 (an AFTER INSERT trigger on auth.users) stops the state from
// arising for new accounts. This module is the client-side half: it repairs an
// account that is ALREADY in that state rather than deepening it.
//
// DETECTION IS FREE
//
// `useUserProfile` falls back to a "core data" object with no `share_code` when
// the row is missing (api.js, the `Profile row not found` branch), while a real
// row always carries one. So the object already in hand says whether a repair is
// needed — no extra SELECT on the hot path.

/**
 * The columns that make a profile row usable. A row missing any of these is a
 * fragment: something can be written to it, but it cannot identify, share or
 * attribute a user.
 */
export const PROFILE_IDENTITY_FIELDS = ['email', 'share_code', 'join_date', 'account_status'];

/**
 * True when `userData` is a real, signed-in user whose profile row is missing or
 * incomplete. Guests and unauthenticated callers are NOT repair candidates —
 * there is nothing to repair for an account that does not exist.
 */
export function profileNeedsRepair(userData) {
    if (!userData || typeof userData !== 'object') return false;
    if (!userData.$id || userData.$id === 'guest') return false;

    // `share_code` is the discriminator: the core-data fallback omits it
    // entirely, and a genuine row always has one (it is UNIQUE, so it is never
    // blank by accident). The rest keep the predicate consistent with
    // PROFILE_IDENTITY_FIELDS, so the two cannot drift.
    if (!userData.share_code && !userData.shareCode) return true;
    if (!userData.email) return true;
    if (!userData.join_date && !userData.joinDate) return true;
    if (!userData.account_status) return true;
    return false;
}

/**
 * Split a "First Last" string the same way migration 009 does, so a repaired row
 * and a trigger-created row agree. Tolerates a single name and extra whitespace.
 */
export function splitFullName(fullName) {
    const value = typeof fullName === 'string' ? fullName.trim() : '';
    if (!value) return { firstName: '', lastName: '' };
    const cut = value.search(/\s/);
    if (cut === -1) return { firstName: value, lastName: '' };
    return {
        firstName: value.slice(0, cut),
        lastName: value.slice(cut).replace(/\s+/g, ' ').trim(),
    };
}

/**
 * Build the complete row payload that turns a fragment into a real profile.
 *
 * Pure: takes the session user, the share code to assign and the timestamp, and
 * returns only the columns a fresh signup writes. The caller passes this to the
 * same idempotent upsert as any other write, so a row that already exists has
 * just these columns refreshed.
 */
export function buildCompleteProfileRow({ user, shareCode, now } = {}) {
    if (!user || !user.$id) return null;

    const { firstName, lastName } = splitFullName(
        user.name || user.user_metadata?.full_name || user.display_name,
    );

    return {
        id: user.$id,
        email: user.email || null,
        first_name: firstName || null,
        last_name: lastName || null,
        join_date: user.$createdAt || now || null,
        account_status: 'active',
        native_language: user.native_language || user.user_metadata?.native_language || null,
        // A repair cannot invent the learner's self-reported level; leave it for
        // the app to fill rather than guessing 'A0' and overwriting a real value.
        english_level: user.english_level || null,
        completed_dates: [],
        share_code: shareCode || null,
    };
}

/**
 * Merge a complete row with an incremental write, so a repair and the progress
 * update that triggered it can travel in one round trip. Fields already present
 * in `complete` win — repairing must not overwrite what the write supplies.
 */
export function mergeProfileRow(complete, incremental) {
    if (!complete) return incremental;
    if (!incremental) return complete;
    return { ...incremental, ...complete };
}