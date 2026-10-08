// Story 056: the profile renders an inviting friend-practice area — a
// headline + subheading, a large course heading, and a bulleted list of
// underlined links — or, when nothing is active, an expired-state message with
// a link to the public course listings. Rendered with react-dom/client
// createRoot + act (the repo convention; no testing-library is installed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60 * 1000;
// Anchor fixtures to the real clock: the component reads Date.now() itself.
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function renderSection(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(FriendLessonLinksSection, props));
    });
    return root;
}

describe('FriendLessonLinksSection', () => {
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

    it('renders the headline, subheading and one labelled anchor per recorded lesson', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Make 3 questions',
            },
            'friendchain:c': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'c', lessonId: 'd', shareCode: 'code1',
                addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Follow Up',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        expect(container.querySelector('[data-testid="friend-lesson-links-heading"]').textContent)
            .toBe('Practice English with Me Free');
        expect(container.querySelector('[data-testid="friend-lesson-links-subheading"]').textContent)
            .toBe('click on a lesson link to start.');

        const heading = container.querySelector('[data-testid="friend-lesson-link-group-heading"]');
        expect(heading.textContent).toBe('Friend Chain');
        expect(parseFloat(heading.style.fontSize)).toBeGreaterThanOrEqual(24);

        const anchors = Array.from(container.querySelectorAll('[data-testid="friend-lesson-link"]'));
        expect(anchors).toHaveLength(2);
        const byLabel = Object.fromEntries(anchors.map((a) => [a.textContent, a.getAttribute('href')]));
        // Each label is paired with its OWN target lesson (b for the 'a' entry, d for the 'c' entry).
        expect(byLabel['Make 3 questions'])
            .toBe('https://ultrafastfluency.com/course/friendchain/lesson/b?shareCode=code1');
        expect(byLabel['Follow Up'])
            .toBe('https://ultrafastfluency.com/course/friendchain/lesson/d?shareCode=code1');

        // Each link carries its own countdown element.
        expect(container.querySelectorAll('[data-testid="friend-lesson-link-countdown"]')).toHaveLength(2);
    });

    it('renders the links as an underlined bulleted list inside a <ul>/<li>', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const list = container.querySelector('[data-testid="friend-lesson-link-list"]');
        expect(list.tagName).toBe('UL');
        expect(list.querySelectorAll('li')).toHaveLength(1);

        const anchor = container.querySelector('[data-testid="friend-lesson-link"]');
        expect(anchor.closest('li')).not.toBeNull();
        expect(anchor.style.textDecoration).toContain('underline');
    });

    it('renders one heading per course, grouped not interleaved', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
            },
            'other:a': {
                courseId: 'other', courseName: 'Other Course',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code2',
                addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Other Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const headings = Array.from(container.querySelectorAll('[data-testid="friend-lesson-link-group-heading"]'))
            .map((h) => h.textContent);
        expect(headings).toEqual(['Friend Chain', 'Other Course']);
        expect(container.querySelectorAll('[data-testid="friend-lesson-link-group"]')).toHaveLength(2);
    });

    it('keeps two courses with the same display name as separate groups', () => {
        const links = {
            'course1:a': {
                courseId: 'course1', courseName: 'Friend Challenge',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Ask One',
            },
            'course2:a': {
                courseId: 'course2', courseName: 'Friend Challenge',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code2',
                addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Ask Two',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        expect(container.querySelectorAll('[data-testid="friend-lesson-link-group"]')).toHaveLength(2);
        expect(container.querySelectorAll('[data-testid="friend-lesson-link"]')).toHaveLength(2);
    });

    it('falls back to the generic link copy and stays clickable when lessonTitle is empty', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: '',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const anchor = container.querySelector('[data-testid="friend-lesson-link"]');
        expect(anchor.textContent).toBe('Practice English with Me');
        expect(anchor.getAttribute('href'))
            .toBe('https://ultrafastfluency.com/course/friendchain/lesson/b?shareCode=code1');
    });

    it('renders its own countdown per link', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const countdown = container.querySelector('[data-testid="friend-lesson-link-countdown"]');
        expect(countdown).not.toBeNull();
        expect(countdown.textContent).toMatch(/^Available for 4[67]h \d+m$/);
    });

    it('shows the expired message and the course-listings link when every entry is expired', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - 49 * HOUR), lessonTitle: 'Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const expired = container.querySelector('[data-testid="friend-lessons-expired"]');
        expect(expired).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-lessons-expired-message"]').textContent)
            .toBe("All this user's lessons have expired after 48 hours, start a new lesson and send them the link to get them back into practicing English.");

        const cta = container.querySelector('[data-testid="friend-lessons-practice-free"]');
        expect(cta.getAttribute('href')).toBe('/courses');
        expect(cta.textContent).toBe('Practice English Free');
        expect(parseFloat(cta.style.fontSize)).toBeGreaterThanOrEqual(24);

        expect(container.querySelector('[data-testid="friend-lesson-links"]')).toBeNull();
        expect(container.querySelectorAll('[data-testid="friend-lesson-link-group"]')).toHaveLength(0);
        expect(container.querySelectorAll('[data-testid="friend-lesson-link"]')).toHaveLength(0);
    });

    it('shows the expired state for an empty or missing friendLinks map', () => {
        root = renderSection(container, { friendLinks: {}, lang: 'en' });
        expect(container.querySelector('[data-testid="friend-lessons-expired"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friend-lesson-links"]')).toBeNull();

        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        root = renderSection(container, { friendLinks: undefined, lang: 'en' });
        expect(container.querySelector('[data-testid="friend-lessons-expired"]')).not.toBeNull();
    });
});
