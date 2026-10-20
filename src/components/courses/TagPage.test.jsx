// A tag page (/tags/<tag>): the courses that carry the tag.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import TagPage from './TagPage.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COURSES = [
    {
        courseId: 'friendchain',
        courseName: 'Friend Challenge',
        lessonCount: 8,
        firstLessonId: 'a',
        mission: { mission: { en: 'Talk about preferences.' } },
        heroImage: 'https://img/hero.jpg',
    },
    {
        courseId: 'model',
        courseName: 'Grocery Shopping',
        lessonCount: 2,
        firstLessonId: 'm-t',
        mission: null,
        heroImage: null,
    },
];

function render(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                MemoryRouter,
                null,
                React.createElement(TagPage, { lang: 'en', tag: 'family', courses: COURSES, ...props }),
            ),
        );
    });
    return root;
}

describe('TagPage', () => {
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

    it('shows the topic as the heading and links back to the welcome page', () => {
        root = render(container, {});

        const heading = container.querySelector('[data-testid="tag-heading"]');
        expect(heading.tagName).toBe('H1');
        expect(heading.textContent).toBe('Family');

        const back = container.querySelector('[data-testid="tag-back"]');
        expect(back.getAttribute('href')).toBe('/welcome');
    });

    it('shows the English topic first and the learner\'s language after it', () => {
        root = render(container, { lang: 'es' });

        const heading = container.querySelector('[data-testid="tag-heading"]');
        expect(heading.textContent).toBe('Family Familia');
        expect(heading.querySelector('[lang="es"]').textContent.trim()).toBe('Familia');
    });

    it('lists one card per course, linking to the course like the listings page', () => {
        root = render(container, {});

        const cards = Array.from(container.querySelectorAll('[data-testid="tag-course-card"]'));
        expect(cards).toHaveLength(2);
        expect(cards[0].getAttribute('href')).toBe('/course/friendchain/lesson/a');
        expect(cards[1].getAttribute('href')).toBe('/course/model/lesson/m-t');
        expect(cards[0].textContent).toContain('Friend Challenge');
        expect(cards[1].textContent).toContain('Grocery Shopping');
        expect(cards[0].textContent).toContain('8 lessons');
    });

    it('shows the hero image of a course that has one', () => {
        root = render(container, {});

        const heroes = Array.from(container.querySelectorAll('[data-testid="course-hero"]'));
        expect(heroes).toHaveLength(1);
        expect(heroes[0].getAttribute('src')).toBe('https://img/hero.jpg');
        expect(heroes[0].getAttribute('alt')).toBe('Friend Challenge');
    });

    it('shows the mission expanded, with its details', () => {
        root = render(container, {});

        const missions = Array.from(container.querySelectorAll('[data-testid="course-mission"]'));
        expect(missions).toHaveLength(1);
        // Expanded by default: the whole mission reads at a glance here, the
        // course listing page collapses it behind a toggle.
        expect(missions[0].className).toContain('expanded');
        expect(missions[0].textContent).toContain('Talk about preferences.');
    });

    it('shows a spinner while the courses load', () => {
        root = render(container, { courses: undefined, isLoading: true });

        expect(container.querySelector('[data-testid="tag-loading"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="tag-course-card"]')).toHaveLength(0);
    });

    it('shows the load error', () => {
        root = render(container, { courses: undefined, isError: true });

        expect(container.querySelector('[data-testid="tag-error"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="tag-course-card"]')).toHaveLength(0);
    });

    it('shows the empty message when no course carries the topic', () => {
        root = render(container, { courses: [] });

        expect(container.querySelector('[data-testid="tag-empty"]').textContent)
            .toBe('No courses for this topic yet. Please check back soon.');
        expect(container.querySelectorAll('[data-testid="tag-course-card"]')).toHaveLength(0);
    });

    it('owns its scrolling: a flex child of the app shell', () => {
        root = render(container, {});

        const page = container.querySelector('[data-testid="tag-page"]');
        expect(page.style.flexGrow).toBe('1');
        expect(page.style.minHeight).toBe('0px');
        expect(page.style.height).toBe('');

        const scroll = container.querySelector('[data-testid="tag-scroll"]');
        expect(scroll.style.overflowY).toBe('auto');
        expect(scroll.contains(container.querySelector('[data-testid="tag-course-card"]'))).toBe(true);
    });
});
