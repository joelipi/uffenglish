import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appStore } from '../../modules/store/store.js';

// Per-test controllable API mocks (defaults preserve the original static
// behavior for the pre-existing suites below).
const apiMocks = vi.hoisted(() => ({
    useUserProfileImpl: vi.fn(() => ({ data: null })),
    useNotificationsImpl: vi.fn(() => ({ data: undefined })),
    fetchUserByShareCodeImpl: vi.fn(async () => null),
}));

// Resolver call log: the component must not recompute the target on
// re-renders with identical inputs (story 061 stability rule). The wrapper
// delegates to the real implementation, so behavior is identical.
const resolverCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../modules/home/continue-logic.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        resolveContinueTarget: (...args) => {
            resolverCalls.count += 1;
            return mod.resolveContinueTarget(...args);
        },
    };
});

// HomeScreen pulls in the Supabase graph, PostHog and the notifications bell.
// Mock the side-effecting ones so the top bar (brand logo) is under test
// without a network or store bootstrap.
vi.mock('../../modules/api/api.js', () => ({
    useAuthStatus: () => ({ data: false }),
    useUserProfile: (...args) => apiMocks.useUserProfileImpl(...args),
    useNotifications: (...args) => apiMocks.useNotificationsImpl(...args),
    fetchUserByShareCode: (...args) => apiMocks.fetchUserByShareCodeImpl(...args),
    signOut: vi.fn(),
}));
vi.mock('../../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
vi.mock('./NotificationsBell.web.jsx', () => ({ default: () => null }));
vi.mock('../../modules/courses/friend-course-configs.js', () => ({
    configCourseId: (p) => String(p).replace(/^.*\//, '').replace(/\.json$/, ''),
    resolveCourseHeroImage: (ref) => ref,
    loadConfigEntries: vi.fn(async () => [
        {
            courseId: 'friend',
            config: { courseName: 'Friend Challenge', lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'b', recapOverlay: 'shareCta' },
            ] },
        },
        {
            courseId: 'wouldrather',
            config: { courseName: 'Would You Rather', lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'b', recapOverlay: 'shareCta' },
                { lessonId: 'c', recapOverlay: 'shareCta' },
            ] },
        },
        {
            courseId: 'model',
            config: { courseName: 'Model', lessons: [{ lessonId: 'm-g' }, { lessonId: 'm-t' }] },
        },
        {
            courseId: 'gt2',
            config: { courseName: 'GT2', lessons: [{ lessonId: 'g-a' }] },
        },
    ]),
}));

import HomeScreen from './HomeScreen.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'HomeScreen.jsx'), 'utf8');

describe('HomeScreen', () => {
    let container;
    let root;
    let client;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        apiMocks.useUserProfileImpl.mockReturnValue({ data: null });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: undefined });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async () => null);
        appStore.setState({ courseId: null, activeLessonId: null });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.setState({ courseId: null, activeLessonId: null });
    });

    async function renderHome() {
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(QueryClientProvider, { client },
                    React.createElement(MemoryRouter, null,
                        React.createElement(HomeScreen)
                    )
                )
            );
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }

    it('renders the UFF logo image in the top bar instead of the text headline', async () => {
        await renderHome();
        const logo = container.querySelector('[data-testid="home-logo"]');
        expect(logo).not.toBeNull();
        expect(logo.tagName).toBe('IMG');
        expect(logo.getAttribute('alt')).toBe('Ultra Fast Fluency');
        expect(container.textContent).not.toContain('Ultra Fast Fluency');
    });

    it('renders no install banner without a signed-in user', async () => {
        // The mocks return no profile (anonymous): no banner, no prompt.
        await renderHome();
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
    });

    it('renders no Privacy/Terms footer on the app dashboard', async () => {
        // The dashboard (/home) keeps the links in the hamburger menu only;
        // the public homepage (/) keeps its footer — see legal-wiring.test.js.
        await renderHome();
        expect(container.querySelector('[data-testid="legal-footer"]')).toBeNull();
        expect(container.querySelector('a[href="/privacy"]')).toBeNull();
        expect(container.querySelector('a[href="/terms"]')).toBeNull();
    });

    it('renders the merged course-listings headline and onboarding steps', async () => {
        await renderHome();
        expect(container.querySelector('[data-testid="friend-courses-heading"]').textContent)
            .toBe('Choose a conversation to have with your friends and practice English with them free.');
        const steps = container.querySelector('[data-testid="friend-courses-steps"]');
        expect(steps.tagName).toBe('OL');
        expect(steps.children).toHaveLength(2);
    });

    it('renders one card per friend course, including Would You Rather', async () => {
        await renderHome();
        const cards = Array.from(container.querySelectorAll('[data-testid="friend-course-card"]'));
        expect(cards).toHaveLength(2);
        expect(cards[0].getAttribute('href')).toBe('/course/friend/lesson/a');
        expect(cards[1].getAttribute('href')).toBe('/course/wouldrather/lesson/a');
        expect(cards[0].textContent).toContain('Friend Challenge');
        expect(cards[1].textContent).toContain('Would You Rather');
    });
});

describe('HomeScreen course-listings wiring', () => {
    it('loads the shared friend-courses query (same cache key as /courses)', () => {
        expect(src).toContain("queryKey: ['friend-courses']");
        expect(src).toContain('loadConfigEntries');
        expect(src).toContain('listFriendCourses');
        expect(src).toContain('resolveCourseHeroImage');
    });

    it('renders the shared FriendCoursesView instead of a hardcoded config card', () => {
        expect(src).toContain('FriendCoursesView');
        expect(src).not.toContain('/src/config/model.json');
        expect(src).not.toContain('/course/model/lesson/m-g');
    });
});

describe('HomeScreen Continue button', () => {
    let container;
    let root;
    let client;
    let locations;

    function LocationProbe() {
        const location = useLocation();
        useEffect(() => {
            locations.push(location.pathname + location.search);
        }, [location]);
        return null;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        locations = [];
        apiMocks.useUserProfileImpl.mockReturnValue({ data: null });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: undefined });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async () => null);
        appStore.setState({ courseId: null, activeLessonId: null });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.setState({ courseId: null, activeLessonId: null });
    });

    async function renderHome() {
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(QueryClientProvider, { client },
                    React.createElement(MemoryRouter, { initialEntries: ['/home'] },
                        React.createElement(LocationProbe),
                        React.createElement(HomeScreen)
                    )
                )
            );
        });
        // Let the config/inbox/friend queries settle.
        await act(async () => {
            await new Promise((r) => setTimeout(r, 100));
        });
        resolverCalls.count = 0;
    }

    async function clickContinue() {
        const button = container.querySelector('[data-testid="home-continue"]');
        expect(button).not.toBeNull();
        await act(async () => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
        return locations[locations.length - 1];
    }

    it('keeps the exact solo link for a non-friend resume, ignoring friend data', async () => {
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        appStore.setState({ courseId: 'model', activeLessonId: 'm-g' });
        await renderHome();
        expect(await clickContinue()).toBe('/course/model/lesson/m-g');
    });

    it('links the oldest active friend entry with ?shareCode=', async () => {
        const hour = 60 * 60 * 1000;
        const now = Date.now();
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}', counted_lessons: ['wouldrather_a'],
        } });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async (code) => {
            if (code !== 'ab12') return null;
            return {
                share_code: 'ab12',
                friendLinks: {
                    'wouldrather:b': {
                        courseId: 'wouldrather', recordedLessonId: 'b', lessonId: 'c',
                        shareCode: 'ab12', addedAt: new Date(now - hour).toISOString(),
                    },
                },
            };
        });
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        expect(await clickContinue()).toBe('/course/wouldrather/lesson/c?shareCode=ab12');
    });

    it('hides Continue when friends are exhausted and no non-friend course started', async () => {
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}',
            counted_lessons: ['friend_a', 'wouldrather_a'],
        } });
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        // Page settled (cards rendered) but no Continue target exists.
        expect(container.querySelector('[data-testid="friend-courses-heading"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="home-continue"]')).toBeNull();
    });

    it('falls back to a random unstarted friend ask lesson for guests', async () => {
        // Guest profile: no inbox, no progress — every friend course counts
        // as unstarted, so the fallback is a solo-startable `a` lesson.
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        const target = await clickContinue();
        expect(target).toMatch(/^\/course\/(friend|wouldrather)\/lesson\/a$/);
    });

    it('skips a friend whose profile fetch rejects and still resolves', async () => {
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}', counted_lessons: [],
        } });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        apiMocks.fetchUserByShareCodeImpl.mockRejectedValue(new Error('offline'));
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        // The failed friend is skipped; the unstarted-friend fallback
        // (wouldrather itself is the resume, so `friend`) still renders.
        expect(await clickContinue()).toBe('/course/friend/lesson/a');
    });

    it('navigates nowhere when nothing resolves at tap time', async () => {
        const hour = 60 * 60 * 1000;
        const now = Date.now();
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}',
            counted_lessons: ['friend_a', 'wouldrather_a'],
        } });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async () => ({
            share_code: 'ab12',
            friendLinks: {
                'wouldrather:b': {
                    courseId: 'wouldrather', recordedLessonId: 'b', lessonId: 'c',
                    shareCode: 'ab12', addedAt: new Date(now - hour).toISOString(),
                },
            },
        }));
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        // Rendered while the link is live...
        expect(container.querySelector('[data-testid="home-continue"]')).not.toBeNull();
        // ...but 49h later nothing resolves (expired, friends exhausted, no
        // non-friend started): the tap must not navigate to the stale link.
        const realNow = Date.now;
        Date.now = () => now + 49 * hour;
        try {
            await clickContinue();
            expect(locations).toEqual(['/home']);
        } finally {
            Date.now = realNow;
        }
    });

    it('navigates to the fresh target when a link expires between render and tap', async () => {
        const hour = 60 * 60 * 1000;
        const now = Date.now();
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}', counted_lessons: ['wouldrather_a'],
        } });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async () => ({
            share_code: 'ab12',
            friendLinks: {
                'wouldrather:b': {
                    courseId: 'wouldrather', recordedLessonId: 'b', lessonId: 'c',
                    shareCode: 'ab12', addedAt: new Date(now - hour).toISOString(),
                },
            },
        }));
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        // Rendered while the link is live.
        expect(container.querySelector('[data-testid="home-continue"]')).not.toBeNull();
        // 49h later the link is expired: the tap resolves just-in-time and
        // falls through to the deterministic unstarted-friend fallback.
        const realNow = Date.now;
        Date.now = () => now + 49 * hour;
        try {
            expect(await clickContinue()).toBe('/course/friend/lesson/a');
        } finally {
            Date.now = realNow;
        }
    });

    it('resolves an identical target across renders with unchanged cache data', async () => {        const hour = 60 * 60 * 1000;
        const now = Date.now();
        apiMocks.useUserProfileImpl.mockReturnValue({ data: {
            $id: 'u1', shareCode: 'zz99', course_progress: '{}', counted_lessons: ['wouldrather_a'],
        } });
        apiMocks.useNotificationsImpl.mockReturnValue({ data: [
            { id: 'n1', type: 'friend_response', payload: { actorShareCode: 'ab12', actorName: 'A' } },
        ] });
        apiMocks.fetchUserByShareCodeImpl.mockImplementation(async () => ({
            share_code: 'ab12',
            friendLinks: {
                'wouldrather:b': {
                    courseId: 'wouldrather', recordedLessonId: 'b', lessonId: 'c',
                    shareCode: 'ab12', addedAt: new Date(now - hour).toISOString(),
                },
            },
        }));
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        const first = await clickContinue();
        act(() => root.unmount());
        root = null;
        await renderHome();
        const second = await clickContinue();
        expect(first).toBe('/course/wouldrather/lesson/c?shareCode=ab12');
        expect(second).toBe(first);
    });

    it('does not recompute the target on re-renders with identical inputs', async () => {
        // Multi-candidate pool: any recompute re-rolls the random pick, so
        // repeated recomputes would observably retarget (the reported
        // flicker). Stable memoization performs zero recomputes here.
        appStore.setState({ courseId: 'wouldrather', activeLessonId: 'b' });
        await renderHome();
        expect(resolverCalls.count).toBe(0);
        for (let i = 0; i < 5; i++) {
            await act(async () => {
                root.render(
                    React.createElement(QueryClientProvider, { client },
                        React.createElement(MemoryRouter, { initialEntries: ['/home'] },
                            React.createElement(LocationProbe),
                            React.createElement(HomeScreen)
                        )
                    )
                );
            });
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0));
            });
        }
        expect(resolverCalls.count).toBe(0);
        expect(container.querySelector('[data-testid="home-continue"]')).not.toBeNull();
    });

    it('renders the Continue bar hidden until we revisit it', async () => {
        appStore.setState({ courseId: 'model', activeLessonId: 'm-g' });
        await renderHome();
        const button = container.querySelector('[data-testid="home-continue"]');
        expect(button).not.toBeNull();
        // Hidden for now (`display: none` on its wrapper), not removed: the
        // element and its target resolution stay wired so re-showing the bar
        // later is a style change, not a re-implementation.
        expect(button.parentElement.style.display).toBe('none');
    });
});

describe('HomeScreen Continue wiring guards', () => {
    it('computes the target in the resolver module, never in the component', () => {
        expect(src).toContain('continue-logic');
        expect(src).toContain('useMemo');
        expect(src).toContain('data-testid="home-continue"');
    });

    it('keeps branching, mapping, and URL building out of the component', () => {
        expect(src).not.toContain('/course/${');
        expect(src).not.toContain('isFriendCourse');
        expect(src).not.toContain('.filter');
        expect(src).not.toContain('.sort');
        expect(src).not.toContain('Math.random');
    });
});
