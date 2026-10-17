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
// migration 009 (an AFTER INSERT trigger on auth.users) stops the state arising
// for new accounts. This module is the client-side half: it repairs an account
// that is ALREADY in that state.
//
// THE ONE RULE THAT MATTERS HERE: NEVER DESTROY DATA
//
// A repair is a write to a row that a learner may already depend on. So this
// module is deliberately conservative:
//
//   - It only ever FILLS fields that are absent or NULL. `completed_dates`,
//     `english_level` and `native_language` are never included in an update,
//     because writing `[]` or `null` over real values would erase a streak or a
//     self-reported level.
//   - It NEVER rotates an EXISTING `share_code`. Share links are printed and
//     published to R2; rotating a real one breaks every link already out in the
//     world. A NULL share code is the opposite case — there is nothing to
//     protect, and the column is UNIQUE so no old value can hide behind it — so
//     a missing one IS filled. Refusing would leave the target accounts with no
//     share code forever.
//   - It never guesses an `english_level`. Inventing 'A0' would overwrite a real
//     answer, so the field is simply left absent.

/** Columns without which a profile row cannot identify, share or attribute a user. */
const IDENTITY_FIELDS = ['email', 'share_code', 'join_date', 'account_status'];

/** True when a real row is missing one of the identity columns. */
export function profileIsIncomplete(row) {
    if (!row || typeof row !== 'object') return false;
    return IDENTITY_FIELDS.some((f) => row[f] === null || row[f] === undefined || row[f] === '');
}

/** The identity columns a real, complete row carries — used by callers/tests. */
export const PROFILE_IDENTITY_FIELDS = IDENTITY_FIELDS;

/**
 * Split a "First Last" string the same way migration 009 does, so a repaired row
 * and a trigger-created row agree. Tolerates a single name and odd whitespace.
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

const present = (v) => v !== null && v !== undefined && v !== '';

/**
 * Decide what a repair should do, and what it may write.
 *
 * Pure — it is handed the row as it actually exists (or null) and the session
 * user, and returns a plan. The caller performs it. Returns one of:
 *
 *   { action: 'none' }              the row is complete, or there is no account
 *   { action: 'insert', payload }   no row exists — write the full profile
 *   { action: 'update', payload }   a row exists but lacks identity — fill ONLY
 *                                   what is missing, never overwrite
 *
 * `row` MUST come from a read that distinguishes "no row" from "read failed".
 * Passing the core-data object `useUserProfile` falls back to when its select
 * throws cannot work: that object is also returned on a transient network or RLS
 * error, so it looks identical to a missing row and would trigger a write
 * against a perfectly healthy profile.
 */
export function planProfileRepair({ row, user, shareCode } = {}) {
    if (!user || !user.$id || user.$id === 'guest') return { action: 'none' };
    if (row && !profileIsIncomplete(row)) return { action: 'none' };

    const { firstName, lastName } = splitFullName(
        user.name || user.user_metadata?.full_name || user.display_name,
    );
    const nativeLanguage = user.native_language || user.user_metadata?.native_language;

    if (!row) {
        // Nothing exists, so nothing can be destroyed.
        return {
            action: 'insert',
            payload: {
                id: user.$id,
                email: present(user.email) ? user.email : null,
                first_name: present(firstName) ? firstName : null,
                last_name: present(lastName) ? lastName : null,
                join_date: user.$createdAt || null,
                account_status: 'active',
                native_language: present(nativeLanguage) ? nativeLanguage : null,
                completed_dates: [],
                share_code: shareCode || null,
            },
        };
    }

    // A row exists: fill ONLY the absent identity fields. Anything already set
    // is left exactly as it is.
    const payload = { id: row.id || user.$id };
    if (!present(row.email) && present(user.email)) payload.email = user.email;
    if (!present(row.join_date)) payload.join_date = user.$createdAt || null;
    if (!present(row.account_status)) payload.account_status = 'active';
    if (!present(row.first_name) && !present(row.last_name)) {
        if (present(firstName)) payload.first_name = firstName;
        if (present(lastName)) payload.last_name = lastName;
    }
    if (!present(row.native_language) && present(nativeLanguage)) {
        payload.native_language = nativeLanguage;
    }
    // A NULL share code is filled (nothing to protect); an existing one is never
    // touched. Without this, a ghost row would stay "incomplete" forever and the
    // caller's guard would block every future write for that account.
    if (!present(row.share_code) && present(shareCode)) payload.share_code = shareCode;

    if (Object.keys(payload).length <= 1) return { action: 'none' };
    return { action: 'update', payload };
}
