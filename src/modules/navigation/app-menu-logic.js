// Pure data + gates for the shared app header's navigation drawer.
//
// The drawer is mounted once by the app shell (src/routes/AppShellLayout.jsx),
// so it is visible on EVERY inside page of the app. Everything about WHAT it
// shows and WHO sees it lives here, so the rules can be unit-tested without
// React and the header component stays render-only.

/**
 * The drawer's entries, in display order.
 *
 * `labelKey` is a key in src/data/strings.js, so every entry follows the app
 * language (guest-first) like the rest of the UI.
 */
export const APP_MENU_ITEMS = [
    { path: '/home', icon: 'bi bi-house-fill', labelKey: 'home_home' },
    { path: '/profile', icon: 'bi bi-person-fill', labelKey: 'home_profile' },
    { path: '/friends', icon: 'bi bi-people-fill', labelKey: 'home_friends' },
    { path: '/privacy', icon: 'bi bi-shield-lock', labelKey: 'legal_privacy' },
    { path: '/terms', icon: 'bi bi-file-earmark-text', labelKey: 'legal_terms' },
];

/**
 * A registered viewer is a signed-in user. The guest stub (`$id: 'guest'`) has
 * no account, so it never sees the install / push entries, and it never gets
 * the notification bell.
 */
export function isRegisteredViewer(viewerId) {
    return !!viewerId && viewerId !== 'guest';
}

/**
 * The drawer's bottom action: sign out for a signed-in user, sign in for
 * everybody else (guests and anonymous visitors).
 */
export function resolveMenuAuthAction({ isLoggedIn } = {}) {
    return isLoggedIn ? 'sign-out' : 'sign-in';
}
