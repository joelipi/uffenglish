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
});
