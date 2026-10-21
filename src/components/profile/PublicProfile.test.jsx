import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Hoisted mocks: the component reads the router, the api layer and the
// chain-head loader. Everything else (the store, the strings table, the
// visitor-language hook) is real, so the guest-first language resolution is
// the thing under test.
const navigate = vi.fn();
const profileState = { data: undefined, isLoading: false };
const authState = { data: false };
const viewerState = { data: { $id: 'guest', native_language: 'EN' } };
const notificationsState = { data: [] };
const friendCompletionsState = { data: [] };

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
}));
// The page now also reads the course configs (for the "Lesson N of M" labels)
// through TanStack Query. This suite is about localization, so the query is
// stubbed empty — the label falls back to the stored title, which the other
// suite covers.
vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({ data: undefined }),
}));
vi.mock('../../modules/api/api.js', () => ({
    useUserByShareCode: () => profileState,
    useAuthStatus: () => authState,
    useUserProfile: () => viewerState,
    useNotifications: () => notificationsState,
    useFriendCompletions: () => friendCompletionsState,
    // user-profile.js (the streak helper's module) imports these at load time.
    getCurrentUser: vi.fn(),
    fetchProfileIdentityRow: vi.fn(),
    syncUserMetaDataMutation: vi.fn(),
}));

import PublicProfile from './PublicProfile.jsx';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = {
    id: 'u1',
    display_name: 'Owner User',
    native_language: 'ES',           // the profile OWNER speaks Spanish
    joinDate: '2026-01-15T00:00:00.000Z',
    shareCode: 'owner1',
    completed_dates: [],
    lessons_completed: 3,
    friends: ['f1'],
    referrals: 2,
};

describe('PublicProfile localization', () => {
    let container;
    let root;
    let previous;

    beforeEach(() => {
        navigate.mockClear();
        profileState.data = OWNER;
        profileState.isLoading = false;
        authState.data = false;
        viewerState.data = { $id: 'guest', native_language: 'EN' };
        notificationsState.data = [];
        friendCompletionsState.data = [];
        previous = appStore.getState();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.setState({
            guestNativeLanguage: previous.guestNativeLanguage,
            userData: previous.userData,
        });
    });

    const render = (shareCode = 'owner1') => {
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(PublicProfile, { shareCode }));
        });
    };

    it('renders the copy in the visitor language, not the profile owner\'s', () => {
        // The visitor chose Hindi; the owner of the profile speaks Spanish.
        appStore.setState({ guestNativeLanguage: 'HI', userData: null });
        render();

        expect(container.textContent).toContain(Strings.get('profile_streak', 'hi'));
        expect(container.textContent).toContain(Strings.get('profile_lessons_completed', 'hi'));
        expect(container.textContent).toContain(Strings.get('profile_days_active', 'hi'));
        // The owner's language must not leak into the copy.
        expect(container.textContent).not.toContain(Strings.get('profile_streak', 'es'));
    });

    it('renders the copy in the visitor language when the visitor is logged in', () => {
        authState.data = true;
        viewerState.data = { $id: 'viewer1', shareCode: 'viewer1', native_language: 'PT', counted_lessons: [] };
        appStore.setState({ guestNativeLanguage: null, userData: { $id: 'viewer1', native_language: 'PT' } });
        render();

        // Portuguese has no copy for these keys yet, so the page falls back to
        // English — but it still follows the VISITOR's language, not the
        // owner's Spanish.
    });

    it('formats the join date in the visitor locale', () => {
        appStore.setState({ guestNativeLanguage: 'ES', userData: null });
        render();

        const expected = new Date(OWNER.joinDate).toLocaleDateString('es');
        expect(container.textContent).toContain(expected);
        // The owner's language (Spanish here) would format it differently.
        expect(expected).not.toBe(new Date(OWNER.joinDate).toLocaleDateString('en'));
    });

    it('localizes the "user not found" state to the visitor language', () => {
        profileState.data = null;
        appStore.setState({ guestNativeLanguage: 'HI', userData: null });
        render();

        expect(container.textContent).toContain(Strings.get('public_profile_not_found', 'hi'));
        expect(container.textContent).not.toContain(Strings.get('public_profile_not_found', 'en'));
    });

    it('localizes the page heading to the visitor language', () => {
        // The heading used to be hardcoded English ("Practice English with")
        // in the JSX, so a Hindi visitor read it in English.
        appStore.setState({ guestNativeLanguage: 'HI', userData: null });
        render();

        expect(container.textContent).toContain(Strings.get('public_profile_heading', 'hi'));
        expect(container.textContent).not.toContain('Practice English with');
    });

    it('localizes the share-code label to the visitor language', () => {
        appStore.setState({ guestNativeLanguage: 'HI', userData: null });
        render();

        expect(container.textContent).toContain(Strings.get('public_profile_share_code', 'hi'));
        expect(container.textContent).toContain('owner1');
        expect(container.textContent).not.toContain('Share Code:');
    });
});

// The badge must be PAIR-scoped: a lesson completed with a different friend
// must never badge on this owner's profile, even though the viewer's own
// completion history contains that lesson. The component passes the
// owner-scoped `friend_completions` list straight through to the logic module.
describe('PublicProfile completed-together badge wiring', () => {
    let container;
    let root;
    let previous;

    const ACTIVE_LINK = {
        courseId: 'friendchain', courseName: 'Friend Chain',
        recordedLessonId: 'a', lessonId: 'b', shareCode: 'owner1',
        lessonTitle: 'Ask',
    };

    beforeEach(() => {
        profileState.data = {
            ...OWNER,
            friendLinks: { 'friendchain:a': { ...ACTIVE_LINK, addedAt: new Date().toISOString() } },
        };
        profileState.isLoading = false;
        authState.data = true;
        viewerState.data = { $id: 'viewer1', shareCode: 'viewer1', native_language: 'EN' };
        notificationsState.data = [];
        friendCompletionsState.data = [];
        previous = appStore.getState();
        container = document.createElement('div');
        document.body.appendChild(container);
        appStore.setState({ guestNativeLanguage: 'EN', userData: { $id: 'viewer1', native_language: 'EN' } });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.setState({
            guestNativeLanguage: previous.guestNativeLanguage,
            userData: previous.userData,
        });
    });

    const render = () => {
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(PublicProfile, { shareCode: 'owner1' }));
        });
    };

    it('badges the entry when the viewer completed its target lesson WITH this owner', () => {
        friendCompletionsState.data = [{ courseId: 'friendchain', lessonId: 'b' }];
        render();

        expect(container.textContent).toContain(Strings.get('profile_completed_together', 'en'));
    });

    it('does not badge it when the completion list for this owner is empty', () => {
        // The owner-scoped read returns nothing when the viewer did that lesson
        // with a different friend, so no badge is rendered here.
        friendCompletionsState.data = [];
        render();

        expect(container.textContent).not.toContain(Strings.get('profile_completed_together', 'en'));
    });
});

// The bug this guards: the page localized itself by the PROFILE OWNER's
// language, so a Spanish visitor reading a Hindi speaker's profile got the
// page in Hindi. The visitor's language comes from useNativeLanguage() (the
// app's guest-first resolution); the owner's `native_language` must never be
// read by the component.
describe('PublicProfile never localizes by the profile owner\'s language', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(__dirname, 'PublicProfile.jsx'), 'utf8');
    // Comments explain the rule, so they are stripped before the check —
    // otherwise the prose about the bug would satisfy the guard by itself.
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    it('reads the language through useNativeLanguage()', () => {
        expect(code).toMatch(/useNativeLanguage\(\)/);
    });

    it('never reads native_language off the profile', () => {
        expect(code).not.toMatch(/profile\s*\??\.\s*native_language/);
        expect(code).not.toMatch(/native_language[^\n]*=\s*profile\b/);
    });
});
