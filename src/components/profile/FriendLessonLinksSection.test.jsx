// Story 041: the profile renders one labelled link per lesson the owner
// recorded, grouped under its course. Rendered with react-dom/client createRoot
// + act (the repo convention; no testing-library is installed).
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

    it('renders a course heading and one labelled anchor per recorded lesson', () => {
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

        const heading = container.querySelector('[data-testid="friend-lesson-link-group-heading"]');
        expect(heading.textContent).toBe('Friend Chain');

        const anchors = container.querySelectorAll('[data-testid="friend-lesson-link"]');
        expect(anchors).toHaveLength(2);
        const hrefs = Array.from(anchors).map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('https://ultrafastfluency.com/course/friendchain/lesson/b?shareCode=code1');
        expect(hrefs).toContain('https://ultrafastfluency.com/course/friendchain/lesson/d?shareCode=code1');

        const labels = Array.from(anchors).map((a) => a.textContent);
        expect(labels).toContain('Make 3 questions');
        expect(labels).toContain('Follow Up');

        // Each link carries its own countdown element.
        expect(container.querySelectorAll('[data-testid="friend-lesson-link-countdown"]')).toHaveLength(2);
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

    it('renders no visible label text when lessonTitle is empty (no fallback)', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: '',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const anchor = container.querySelector('[data-testid="friend-lesson-link"]');
        expect(anchor.textContent).toBe('');
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

    it('renders nothing when every entry is expired', () => {
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - 48 * HOUR), lessonTitle: 'Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        expect(container.querySelector('[data-testid="friend-lesson-link"]')).toBeNull();
        expect(container.querySelector('[data-testid="friend-lesson-links"]')).toBeNull();
    });

    it('returns null with no entries', () => {
        root = renderSection(container, { friendLinks: {}, lang: 'en' });
        expect(container.querySelector('[data-testid="friend-lesson-links"]')).toBeNull();
    });
});
