// Story 056: the public course-listings page. Rendered with react-dom/client
// createRoot + act (the repo convention; no testing-library is installed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import CourseListings from './CourseListings.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COURSES = [
    { courseId: 'friendchain', courseName: 'Friend Chain', lessonCount: 8, firstLessonId: 'a' },
    { courseId: 'wouldyourather', courseName: 'Prefs', lessonCount: 2, firstLessonId: 'a' },
];

function render(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(CourseListings, { lang: 'en', onBack: () => {}, ...props }));
    });
    return root;
}

describe('CourseListings', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    it('renders the heading and the two numbered onboarding steps', () => {
        root = render(container, { courses: COURSES });

        expect(container.querySelector('[data-testid="friend-courses-heading"]').textContent)
            .toBe('Choose a conversation to have with your friends and practice English with them free.');

        const steps = container.querySelector('[data-testid="friend-courses-steps"]');
        expect(steps.tagName).toBe('OL');
        const items = Array.from(steps.children);
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toBe('Complete the first mini lesson in under five minutes.');
        expect(items[1].textContent).toBe(
            'Share your special link with friends, family, and colleagues so that they can reply to you and continue the conversation.'
        );
        // Normal text, not heading elements.
        for (const item of items) {
            expect(item.tagName).toBe('LI');
            expect(item.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
        }
    });

    it('renders one course card per course, in order, linking to the first lesson', () => {
        root = render(container, { courses: COURSES });

        const cards = Array.from(container.querySelectorAll('[data-testid="friend-course-card"]'));
        expect(cards).toHaveLength(2);
        expect(cards[0].getAttribute('href')).toBe('/course/friendchain/lesson/a');
        expect(cards[1].getAttribute('href')).toBe('/course/wouldyourather/lesson/a');
        expect(cards[0].textContent).toContain('Friend Chain');
        expect(cards[1].textContent).toContain('Prefs');
        expect(cards[0].textContent).toContain('8 lessons');
        expect(cards[1].textContent).toContain('2 lessons');
    });

    it('shows the install banner for signed-in users, never for guests', () => {
        // jsdom has no matchMedia: never standalone, so a userId shows it.
        root = render(container, { courses: COURSES, userId: 'user-1' });
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).not.toBeNull();
        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        root = render(container, { courses: COURSES, userId: 'guest' });
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        root = render(container, { courses: COURSES });
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
    });

    it('shows a spinner (and still the heading/steps) while loading', () => {
        root = render(container, { courses: undefined, isLoading: true });

        expect(container.querySelector('[data-testid="friend-courses-loading"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(0);
        expect(container.querySelector('[data-testid="friend-courses-heading"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-courses-steps"]')).not.toBeNull();
    });

    it('shows the load error (and still the heading/steps) on failure', () => {
        root = render(container, { courses: undefined, isError: true });

        const error = container.querySelector('[data-testid="friend-courses-error"]');
        expect(error).not.toBeNull();
        expect(error.textContent).toBe('Failed to load courses. Please try again later.');
        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(0);
        expect(container.querySelector('[data-testid="friend-courses-heading"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-courses-steps"]')).not.toBeNull();
    });

    it('shows the empty message (and still the heading/steps) with no courses', () => {
        root = render(container, { courses: [] });

        const empty = container.querySelector('[data-testid="friend-courses-empty"]');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('No friend courses are available right now. Please check back soon.');
        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(0);
        expect(container.querySelector('[data-testid="friend-courses-heading"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-courses-steps"]')).not.toBeNull();
    });

    it('renders no hero banner or mission dropdown without that metadata', () => {
        root = render(container, { courses: COURSES });

        expect(container.querySelectorAll('[data-testid="course-hero"]')).toHaveLength(0);
        expect(container.querySelectorAll('[data-testid="course-mission"]')).toHaveLength(0);
    });

    it('renders the hero banner when a course carries a hero image', () => {
        root = render(container, {
            courses: [
                { courseId: 'friend', courseName: 'Friend', lessonCount: 2, firstLessonId: 'a', mission: null, heroImage: 'https://img/hero.jpg' },
            ],
        });

        const hero = container.querySelector('[data-testid="course-hero"]');
        expect(hero).not.toBeNull();
        expect(hero.tagName).toBe('IMG');
        expect(hero.getAttribute('src')).toBe('https://img/hero.jpg');
        expect(hero.getAttribute('alt')).toBe('Friend');
    });

    it('renders the mission dropdown when a course carries mission metadata', () => {
        root = render(container, {
            courses: [
                {
                    courseId: 'friend',
                    courseName: 'Friend',
                    lessonCount: 2,
                    firstLessonId: 'a',
                    mission: { mission: { en: 'Ask questions' }, setting: { en: 'Park' } },
                    heroImage: null,
                },
            ],
        });

        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown).not.toBeNull();
        expect(dropdown.textContent).toContain('Ask questions');
        expect(dropdown.textContent).toContain('Park');
    });
});

describe('CourseListings scrolling', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    it('owns its scrolling: 100dvh clipping shell with a scrollable body region', () => {
        root = render(container, { courses: COURSES });

        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        expect(scroll).not.toBeNull();
        expect(scroll.style.overflowY).toBe('auto');
        expect(scroll.style.flex || scroll.style.flexGrow).toBeTruthy();

        const shell = scroll.parentElement;
        expect(shell.style.height).toBe('100dvh');
        expect(shell.style.display).toBe('flex');
        expect(shell.style.flexDirection).toBe('column');
        expect(shell.style.overflow).toBe('hidden');
    });

    it('keeps the header outside the scroll region and the content inside it', () => {
        root = render(container, { courses: COURSES });

        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        const shell = scroll.parentElement;
        const header = container.querySelector('[data-testid="friend-courses-back"]').parentElement;

        expect(shell.contains(header)).toBe(true);
        expect(scroll.contains(header)).toBe(false);
        expect(header.parentElement).toBe(shell);

        expect(container.querySelector('[data-testid="friend-courses-heading"]').closest('[data-testid="friend-courses-scroll"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-courses-steps"]').closest('[data-testid="friend-courses-scroll"]')).not.toBeNull();
        const cards = Array.from(container.querySelectorAll('[data-testid="friend-course-card"]'));
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
            expect(scroll.contains(card)).toBe(true);
        }
    });

    it('keeps the scroll region in loading, error and empty states', () => {
        const states = [
            { courses: undefined, isLoading: true },
            { courses: undefined, isError: true },
            { courses: [] },
        ];
        for (const props of states) {
            const stateContainer = document.createElement('div');
            document.body.appendChild(stateContainer);
            const stateRoot = render(stateContainer, props);
            try {
                const scroll = stateContainer.querySelector('[data-testid="friend-courses-scroll"]');
                expect(scroll).not.toBeNull();
                expect(scroll.style.overflowY).toBe('auto');
            } finally {
                act(() => stateRoot.unmount());
                stateContainer.remove();
            }
        }
    });
});
