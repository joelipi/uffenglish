// Story 056: the profile renders an inviting friend-practice area — a
// headline + subheading, a large course heading, and a bulleted list of
// underlined links — or, when nothing is active, an expired-state message with
// a link to the public course listings. Rendered with react-dom/client
// createRoot + act (the repo convention; no testing-library is installed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60 * 1000;
// Anchor fixtures to the real clock: the component reads Date.now() itself.
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// The lesson links are react-router <Link>s, so the component needs a router
// context. A MemoryRouter is enough: it renders the same anchors and keeps the
// navigation client-side (no document load).
function renderSection(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                MemoryRouter,
                { initialEntries: ['/owner1'] },
                React.createElement(FriendLessonLinksSection, props)
            )
        );
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
            .toBe('Click on a lesson to start practicing with  right now free!');
        expect(container.querySelector('[data-testid="friend-lesson-links-subheading"]').textContent)
            .toBe(' does not have to be online now, they can respond to you later.');

        const heading = container.querySelector('[data-testid="friend-lesson-link-group-heading"]');
        expect(heading.textContent).toBe('Friend Chain');
        expect(parseFloat(heading.style.fontSize)).toBeGreaterThanOrEqual(24);

        const anchors = Array.from(container.querySelectorAll('[data-testid="friend-lesson-link"]'));
        expect(anchors).toHaveLength(2);
        const byLabel = Object.fromEntries(anchors.map((a) => [a.textContent, a.getAttribute('href')]));
        // Each label is paired with its OWN target lesson (b for the 'a' entry, d for the 'c' entry).
        // The href is a PATH, not an absolute URL: the link is a react-router
        // <Link>, so the click is a client-side navigation and the browser
        // never loads a new document for it.
        expect(byLabel['Make 3 questions'])
            .toBe('/course/friendchain/lesson/b?shareCode=code1');
        expect(byLabel['Follow Up'])
            .toBe('/course/friendchain/lesson/d?shareCode=code1');

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
            .toBe('/course/friendchain/lesson/b?shareCode=code1');
    });

    it('renders the lesson link as a relative in-app path, not an absolute URL', () => {
        // The regression guard for the "black error screen" report: the link
        // used to be a plain <a href> with an absolute URL, so the click was a
        // DOCUMENT load — the only thing in the app that can end in a
        // browser-level "This site can't be reached / ERR_FAILED" page, and it
        // also threw the in-memory guest language away. A react-router <Link>
        // to a path keeps the click inside the SPA.
        const links = {
            'friendchain:a': {
                courseId: 'friendchain', courseName: 'Friend Chain',
                recordedLessonId: 'a', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const anchor = container.querySelector('[data-testid="friend-lesson-link"]');
        const href = anchor.getAttribute('href');
        expect(href.startsWith('/course/')).toBe(true);
        // No host in the href: an absolute URL would leave the app's own
        // router, i.e. it would be a document load again.
        expect(href).not.toContain('://');
        expect(href).not.toContain(window.location.origin);
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
        expect(cta.textContent).toBe('Start here');
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

// Story 064: visitor-aware rendering. Logged-out visitors get a login/guest
// banner and the section anchor; a completed-together entry gets a badge below
// its countdown (the countdown markup itself stays byte-identical).
describe('FriendLessonLinksSection visitor awareness', () => {
    let container;
    let root;

    const activeLinks = () => ({
        'friendchain:a': {
            courseId: 'friendchain', courseName: 'Friend Chain',
            recordedLessonId: 'a', lessonId: 'b', shareCode: 'owner1',
            addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
        },
    });

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

    it('renders the login/guest banner and the section anchor for a logged-out visitor', () => {
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1' });

        const banner = container.querySelector('[data-testid="visitor-login-banner"]');
        expect(banner).not.toBeNull();

        const login = container.querySelector('[data-testid="visitor-login-link"]');
        expect(login.textContent).toBe("Log in to see lessons you've done together.");
        const href = login.getAttribute('href');
        expect(href.startsWith('/login?redirect=')).toBe(true);
        expect(decodeURIComponent(href.slice('/login?redirect='.length))).toBe('/owner1');

        const guest = container.querySelector('[data-testid="visitor-guest-note"]');
        expect(guest.textContent).toBe('No account yet? Start practicing free. Click one of the links below to start.');
        // Plain text, not a link: it points at the links below it.
        expect(guest.tagName).toBe('P');
        expect(guest.querySelector('a')).toBeNull();
        expect(container.querySelector('[data-testid="visitor-guest-link"]')).toBeNull();

        expect(container.querySelectorAll('#friend-lesson-links')).toHaveLength(1);
    });

    it('renders no banner for a logged-in visitor', () => {
        const viewer = { shareCode: 'viewer1', counted_lessons: [], notifications: [], ownerShareCode: 'owner1' };
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1', viewer });
        expect(container.querySelector('[data-testid="visitor-login-banner"]')).toBeNull();
        expect(container.querySelector('[data-testid="friend-lesson-links-heading"]')).not.toBeNull();
    });

    it('renders no banner in the expired state', () => {
        const expired = {
            'friendchain:a': { ...activeLinks()['friendchain:a'], addedAt: iso(NOW - 49 * HOUR) },
        };
        root = renderSection(container, { friendLinks: expired, lang: 'en', shareCode: 'owner1' });
        expect(container.querySelector('[data-testid="visitor-login-banner"]')).toBeNull();
        expect(container.querySelector('[data-testid="friend-lessons-expired"]')).not.toBeNull();
        expect(container.querySelectorAll('#friend-lesson-links')).toHaveLength(1);
    });

    it('badges an entry completed together, leaving the countdown markup unchanged', () => {
        // Baseline (no badge) capture of the countdown's own markup.
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1' });
        const baseline = container.querySelector('[data-testid="friend-lesson-link-countdown"]').outerHTML;
        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        const viewer = { shareCode: 'viewer1', counted_lessons: ['friendchain_a'], notifications: [], ownerShareCode: 'owner1' };
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1', viewer });

        const badge = container.querySelector('[data-testid="friend-lesson-link-completed"]');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('You did this together');
        const countdown = container.querySelector('[data-testid="friend-lesson-link-countdown"]');
        expect(countdown.outerHTML).toBe(baseline);
        // The badge is a sibling AFTER the countdown, not inside it.
        expect(countdown.nextElementSibling).toBe(badge);
    });

    it('renders no badge when completedTogether is false or absent', () => {
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1' });
        expect(container.querySelector('[data-testid="friend-lesson-link-completed"]')).toBeNull();
        expect(container.querySelector('[data-testid="friend-lesson-link-countdown"]').nextElementSibling).toBeNull();

        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        const viewer = { shareCode: 'viewer1', counted_lessons: [], notifications: [], ownerShareCode: 'owner1' };
        root = renderSection(container, { friendLinks: activeLinks(), lang: 'en', shareCode: 'owner1', viewer });
        expect(container.querySelector('[data-testid="friend-lesson-link-completed"]')).toBeNull();
    });
});
