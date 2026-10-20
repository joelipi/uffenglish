import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the / vs /home navigation wiring. The components pull in
// Supabase/react-query graphs, so this locks each call site by raw source.
// Every slice is scoped to a specific block (AGENTS.md) — never whole-file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const loginRoute = read('./LoginRoute.jsx');
const homeScreen = read('../components/homescreen/HomeScreen.jsx');
const appHeader = read('../components/layout/AppHeader.web.jsx');
const appMenu = read('../modules/navigation/app-menu-logic.js');
const lessonContainer = read('../components/LessonContainer.jsx');
const userProfile = read('../components/profile/UserProfile.jsx');
const publicProfile = read('../components/profile/PublicProfile.jsx');
const notificationsSpec = read('../../tests/notifications.spec.js');

describe('LoginRoute post-auth redirect', () => {
    it('defaults the redirect to /home', () => {
        expect(loginRoute).toContain("searchParams.get('redirect') || '/home'");
    });

    it('no longer defaults the redirect to /', () => {
        expect(loginRoute).not.toContain("searchParams.get('redirect') || '/'");
    });
});

// Story 070 closed the standalone signup page. Its assertions live in ONE place
// — `routes.test.js` (route table + component source) and `SignupRoute.test.jsx`
// (behaviour) — rather than repeated here as a third home, so a future edit to
// `SignupRoute.jsx` has a single guard to satisfy.

// The drawer is the SHARED app header's menu (every inside page shows it), so
// the entries live in one module and the header renders that module.
describe('app menu Home link', () => {
    it('links the menu Home entry at /home', () => {
        expect(appMenu).toContain("path: '/home'");
        expect(appMenu).toContain("labelKey: 'home_home'");
    });

    it('no longer links the menu Home entry at /', () => {
        // The landing page is not a drawer entry (the drawer lists the app's
        // inside pages only), so a bare "/" path must not reappear.
        expect(appMenu).not.toContain("path: '/'");
    });

    it('renders the shared entries in the header', () => {
        // The header must render the module's list, not a copy of it.
        expect(appHeader).toContain('APP_MENU_ITEMS.map');
        expect(appHeader).toContain('to={item.path}');
    });
});

describe('app menu sign-out', () => {
    const signOutAt = appHeader.indexOf('async function handleSignOut');
    // End at the next guaranteed top-level marker (the Escape-key effect that
    // follows), never at EOF (AGENTS.md).
    const effectAt = appHeader.indexOf('useEffect', signOutAt);
    const signOutBlock = appHeader.slice(signOutAt, effectAt);

    it('returns to the public homepage after sign out', () => {
        expect(signOutAt).toBeGreaterThan(-1);
        expect(effectAt).toBeGreaterThan(signOutAt);
        expect(signOutBlock).toContain("navigate('/')");
        expect(signOutBlock).toContain('async function handleSignOut');
    });
});

// The header is mounted ONCE by the app shell, so a page that renders its own
// brand bar would show the header twice.
describe('the dashboard does not render its own header', () => {
    it('has no brand bar or bell of its own', () => {
        expect(homeScreen).not.toContain('data-testid="home-logo"');
        expect(homeScreen).not.toContain('<NotificationsBell');
        expect(homeScreen).not.toContain('data-testid="app-header"');
    });
});

describe('LessonContainer close link', () => {
    const closeAt = lessonContainer.indexOf('id="closePage"');
    const closeBlock = lessonContainer.slice(closeAt - 60, closeAt + 260);

    it('closes to the dashboard at /home', () => {
        expect(closeBlock).toContain('to="/home"');
    });

    it('no longer closes to /', () => {
        expect(closeBlock).not.toContain('to="/"');
    });
});

describe('notifications E2E boots the dashboard', () => {
    it('navigates to /home in bootAndSettle', () => {
        const bootAt = notificationsSpec.indexOf('async function bootAndSettle');
        const bootBlock = notificationsSpec.slice(bootAt, notificationsSpec.indexOf('async function inject', bootAt));
        expect(bootBlock).toContain("page.goto('/home')");
    });

    it('never navigates to /', () => {
        expect(notificationsSpec).not.toContain("page.goto('/')");
    });
});
