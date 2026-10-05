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
const signupRoute = read('./SignupRoute.jsx');
const homeScreen = read('../components/homescreen/HomeScreen.jsx');
const lessonContainer = read('../components/LessonContainer.jsx');
const userProfile = read('../components/profile/UserProfile.jsx');
const publicProfile = read('../components/profile/PublicProfile.jsx');
const notificationsSpec = read('../../tests/notifications.spec.js');

describe('LoginRoute / SignupRoute post-auth redirect', () => {
    it('defaults the redirect to /home', () => {
        expect(loginRoute).toContain("searchParams.get('redirect') || '/home'");
        expect(signupRoute).toContain("searchParams.get('redirect') || '/home'");
    });

    it('no longer defaults the redirect to /', () => {
        expect(loginRoute).not.toContain("searchParams.get('redirect') || '/'");
        expect(signupRoute).not.toContain("searchParams.get('redirect') || '/'");
    });
});

describe('HomeScreen dashboard menu Home link', () => {
    const menuAt = homeScreen.indexOf("Strings.get('home_home'");
    const linkAt = homeScreen.lastIndexOf('<Link', menuAt);
    const menuBlock = homeScreen.slice(linkAt, menuAt);

    it('links the menu Home entry at /home', () => {
        expect(menuBlock).toContain('to="/home"');
    });

    it('no longer links the menu Home entry at /', () => {
        expect(menuBlock).not.toContain('to="/"');
    });
});

describe('HomeScreen sign-out', () => {
    const signOutAt = homeScreen.indexOf('async function handleSignOut');
    // End at the next guaranteed top-level marker (the `const brandGradient`
    // declaration that follows the useEffect), never at EOF (AGENTS.md).
    const brandAt = homeScreen.indexOf('const brandGradient', signOutAt);
    const signOutBlock = homeScreen.slice(signOutAt, brandAt);

    it('returns to the public homepage after sign out', () => {
        expect(signOutAt).toBeGreaterThan(-1);
        expect(brandAt).toBeGreaterThan(signOutAt);
        expect(signOutBlock).toContain("navigate('/')");
        expect(signOutBlock).toContain('async function handleSignOut');
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

describe('UserProfile back navigation', () => {
    it('returns to the dashboard at /home', () => {
        expect(userProfile).toContain("navigate('/home')");
    });

    it('no longer returns to /', () => {
        expect(userProfile).not.toContain("navigate('/')");
    });
});

describe('PublicProfile back navigation is unchanged', () => {
    it('still returns to the public homepage at /', () => {
        expect(publicProfile).toContain("navigate('/')");
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
