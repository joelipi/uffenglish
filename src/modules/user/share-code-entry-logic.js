// modules/user/share-code-entry-logic.js
// Pure decision logic for the public homepage's friend share-code entry.
// Kept free of React, the store, the DOM, and Supabase so it is unit-testable.

export const GO_LESSON_PATH = '/course/wouldrather/lesson/a';

const ERROR_KEYS = {
    empty: 'home_landing_code_required',
    not_found: 'home_landing_code_not_found',
    lookup_failed: 'home_landing_lookup_error',
};

// Share codes are generated lowercase-only. Normalize the way the existing
// entry points do (App.jsx, getShareCodeFromSearch): trim + lowercase. Returns
// null for a non-string or an all-whitespace code.
export function normalizeShareCode(raw) {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toLowerCase();
    return code || null;
}

// Decide what a submitted code should do. `profile` is the lookup result
// (null when no profile exists). Normalization is idempotent, so callers may
// pass an already-normalized code.
export function planShareCodeSubmit({ rawCode, profile } = {}) {
    const code = normalizeShareCode(rawCode);
    if (!code) return { action: 'error', reason: 'empty' };
    if (!profile) return { action: 'error', reason: 'not_found' };
    return { action: 'navigate', to: `/${code}` };
}

export function shareCodeErrorStringKey(reason) {
    return ERROR_KEYS[reason] || ERROR_KEYS.lookup_failed;
}
