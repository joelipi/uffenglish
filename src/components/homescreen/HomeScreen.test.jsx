import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// HomeScreen pulls in the Supabase graph, PostHog, the notifications bell and
// the legal footer. Mock the side-effecting ones so the top bar (brand logo) is
// under test without a network or store bootstrap.
vi.mock('../../modules/api/api.js', () => ({
    useAuthStatus: () => ({ data: false }),
    useUserProfile: () => ({ data: null }),
    signOut: vi.fn(),
}));
vi.mock('../../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
vi.mock('./NotificationsBell.web.jsx', () => ({ default: () => null }));
vi.mock('../legal/LegalFooter.jsx', () => ({ default: () => null }));
vi.mock('../../modules/courses/friend-course-configs.js', () => ({
    configCourseId: (p) => String(p).replace(/^.*\//, '').replace(/\.json$/, ''),
    loadConfigEntries: vi.fn(async () => [
        {
            courseId: 'friend',
            config: { courseName: 'Friend Challenge', lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }] },
        },
        {
            courseId: 'wouldrather',
            config: { courseName: 'Would You Rather', lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }] },
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
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
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
    });

    it('renders the shared FriendCoursesView instead of a hardcoded config card', () => {
        expect(src).toContain('FriendCoursesView');
        expect(src).not.toContain('/src/config/model.json');
        expect(src).not.toContain('/course/model/lesson/m-g');
    });
});
