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
        expect(items[0].textContent).toBe(
            "Complete the first mini lesson in under five minutes. You'll create your free account at the end."
        );
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

// Story 070: the signed-out notice that tells a guest where an account comes
// from now that the standalone signup page is closed.
describe('CourseListings signed-out notice', () => {
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

    it('tells a guest they are not signed in and how to get an account', () => {
        root = render(container, { courses: COURSES, userId: 'guest' });

        const notice = container.querySelector('[data-testid="courses-guest-notice"]');
        expect(notice).not.toBeNull();
        expect(notice.textContent).toContain("You're not signed in");
        expect(notice.textContent).toContain(
            'New here? Complete a mini lesson in under five minutes and create your free account at the end.'
        );
    });

    it('offers a sign-in link that returns the visitor to /courses', () => {
        root = render(container, { courses: COURSES, userId: 'guest' });

        const link = container.querySelector('[data-testid="courses-guest-signin"]');
        expect(link).not.toBeNull();
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('href')).toBe('/login?redirect=%2Fcourses');
        // The label reuses the existing auth copy rather than a new string.
        expect(link.textContent).toBe('Sign In');
    });

    it('is hidden for a signed-in viewer', () => {
        root = render(container, { courses: COURSES, userId: 'user-1' });

        expect(container.querySelector('[data-testid="courses-guest-notice"]')).toBeNull();
        expect(container.querySelector('[data-testid="courses-guest-signin"]')).toBeNull();
    });

    it('waits for the profile query: unknown viewer is not a guest, sentinel is', () => {
        // `userId` is undefined *while the profile query loads*, which is NOT
        // the same as being a guest — a signed-in user cold-loading the page
        // must not be told they are not signed in (story 070 review). Once the
        // query settles the anonymous visitor carries the 'guest' sentinel and
        // the notice appears.
        const resolvingContainer = document.createElement('div');
        document.body.appendChild(resolvingContainer);
        const resolvingRoot = render(resolvingContainer, { courses: COURSES, userId: undefined, isResolving: true });
        try {
            expect(resolvingContainer.querySelector('[data-testid="courses-guest-notice"]')).toBeNull();
            expect(resolvingContainer.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
        } finally {
            act(() => resolvingRoot.unmount());
            resolvingContainer.remove();
        }

        root = render(container, { courses: COURSES, userId: 'guest' });
        expect(container.querySelector('[data-testid="courses-guest-notice"]')).not.toBeNull();
    });

    it('sits above the scroll region rather than inside it', () => {
        root = render(container, { courses: COURSES, userId: 'guest' });

        const notice = container.querySelector('[data-testid="courses-guest-notice"]');
        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        // Same shell as the header: a sibling of the scroller, not a child.
        expect(scroll.contains(notice)).toBe(false);
        expect(notice.parentElement).toBe(scroll.parentElement);
        const order = Array.from(notice.parentElement.children);
        expect(order.indexOf(notice)).toBeLessThan(order.indexOf(scroll));
        // The course list still scrolls inside the region below it.
        expect(scroll.contains(container.querySelector('[data-testid="friend-courses-heading"]'))).toBe(true);
    });

    it('is not nested inside the signed-in-only install/notification banners', () => {
        root = render(container, { courses: COURSES, userId: 'guest' });

        // A guest must see the notice but neither of these, so the two blocks
        // cannot be ancestors of one another.
        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        const notice = container.querySelector('[data-testid="courses-guest-notice"]');
        expect(scroll.contains(notice)).toBe(false);
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
    });

    it('localizes the notice and the step copy together', () => {
        root = render(container, { courses: COURSES, userId: 'guest', lang: 'hi' });

        const notice = container.querySelector('[data-testid="courses-guest-notice"]');
        expect(notice.textContent).toContain('आप साइन इन नहीं हैं');
        expect(container.querySelector('[data-testid="friend-courses-steps"]').textContent)
            .toContain('अंत में आपका मुफ़्त खाता बन जाएगा');
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

    it('owns its scrolling: a flex child of the app shell with a scrollable body region', () => {
        root = render(container, { courses: COURSES });

        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        expect(scroll).not.toBeNull();
        expect(scroll.style.overflowY).toBe('auto');
        expect(scroll.style.flex || scroll.style.flexGrow).toBeTruthy();

        const shell = scroll.parentElement;
        // The frame height belongs to the app shell
        // (src/routes/AppShellLayout.jsx): the page is a flex child of the
        // region below the shared header, so it must not claim a height.
        expect(shell.style.flexGrow).toBe('1');
        expect(shell.style.minHeight).toBe('0px');
        expect(shell.style.height).toBe('');
        expect(shell.style.display).toBe('flex');
        expect(shell.style.flexDirection).toBe('column');
        expect(shell.style.overflow).toBe('hidden');
    });

    it('keeps the header outside the scroll region and the content inside it', () => {
        root = render(container, { courses: COURSES });

        const scroll = container.querySelector('[data-testid="friend-courses-scroll"]');
        const shell = scroll.parentElement;
        const header = container.querySelector('[data-testid="friend-courses-scroll"]').previousElementSibling;

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

// The topic picker on the course lists: a subheading that says what it is
// for, and a drop-down that narrows the list to one topic.
describe('CourseListings topic filter', () => {
    let container;
    let root;

    const TOPIC_COURSES = [
        {
            courseId: 'friendchain',
            courseName: 'Friend Chain',
            lessonCount: 8,
            firstLessonId: 'a',
            mission: null,
            heroImage: null,
            tags: ['family', 'friends'],
        },
        {
            courseId: 'wouldyourather',
            courseName: 'Prefs',
            lessonCount: 2,
            firstLessonId: 'a',
            mission: null,
            heroImage: null,
            tags: ['preferences'],
        },
    ];

    // React tracks the select's value, so the native setter is used to change
    // it — assigning `select.value` alone would not fire the change handler.
    const selectTopic = (select, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        act(() => {
            setter.call(select, value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };

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

    it('shows the subheading just above the drop-down, English first', () => {
        root = render(container, { courses: TOPIC_COURSES });

        const subheading = container.querySelector('[data-testid="course-topic-heading"]');
        expect(subheading).not.toBeNull();
        expect(subheading.textContent).toContain('Choose a topic to practice talking about.');
        // The subheading sits directly above the drop-down.
        const filter = container.querySelector('[data-testid="course-topic-filter"]');
        expect(subheading.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('localizes the subheading, English first', () => {
        root = render(container, { courses: TOPIC_COURSES, lang: 'es' });

        const subheading = container.querySelector('[data-testid="course-topic-heading"]');
        expect(subheading.textContent).toContain('Elige un tema para practicar hablando.');
        expect(subheading.textContent.indexOf('Choose a topic')).toBeLessThan(subheading.textContent.indexOf('Elige un tema'));
    });

    it('offers one option per topic, plus "all topics"', () => {
        root = render(container, { courses: TOPIC_COURSES });

        const select = container.querySelector('[data-testid="course-topic-select"]');
        const options = Array.from(select.querySelectorAll('option'));
        expect(options[0].textContent).toBe('All topics');
        expect(options.map((o) => o.value)).toEqual(['', 'family', 'friends', 'preferences']);
        // The options carry the bilingual topic name: English first.
        expect(options[1].textContent).toBe('Family');
    });

    it('narrows the cards to the courses of the chosen topic', () => {
        root = render(container, { courses: TOPIC_COURSES });

        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(2);

        const select = container.querySelector('[data-testid="course-topic-select"]');
        selectTopic(select, 'preferences');

        const cards = container.querySelectorAll('[data-testid="friend-course-card"]');
        expect(cards).toHaveLength(1);
        expect(cards[0].textContent).toContain('Prefs');
    });

    it('"all topics" brings every course back', () => {
        root = render(container, { courses: TOPIC_COURSES });

        const select = container.querySelector('[data-testid="course-topic-select"]');
        selectTopic(select, 'family');
        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(1);

        selectTopic(select, '');
        expect(container.querySelectorAll('[data-testid="friend-course-card"]')).toHaveLength(2);
    });

    it('shows no drop-down when no course carries a topic', () => {
        root = render(container, { courses: [{ courseId: 'a', courseName: 'A', lessonCount: 1, firstLessonId: 'a', mission: null, heroImage: null, tags: [] }] });

        expect(container.querySelector('[data-testid="course-topic-filter"]')).toBeNull();
    });
});

// The course name is curriculum content, so it is localized: the card shows
// the English name first and the learner's language after it.
describe('the course card title', () => {
    let container;
    let root;

    const LOCALIZED_COURSE = {
        courseId: 'model',
        courseName: 'Grocery Shopping',
        courseNames: {
            en: 'Grocery Shopping',
            es: 'Ir de compras',
            pt: 'Ir às compras',
        },
        lessonCount: 2,
        firstLessonId: 'm-t',
        mission: null,
        heroImage: null,
        tags: ['food'],
    };

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

    it('shows the English name and the learner\'s language beside it', () => {
        root = render(container, { courses: [LOCALIZED_COURSE], lang: 'es' });

        const card = container.querySelector('[data-testid="friend-course-card"]');
        expect(card.textContent).toContain('Grocery Shopping');
        expect(card.textContent).toContain('Ir de compras');
        // The English word comes first.
        const title = card.querySelector('h2');
        expect(title.textContent.indexOf('Grocery Shopping')).toBeLessThan(title.textContent.indexOf('Ir de compras'));
    });

    it('shows only the English name for an English learner', () => {
        root = render(container, { courses: [LOCALIZED_COURSE], lang: 'en' });

        const title = container.querySelector('[data-testid="friend-course-card"] h2');
        expect(title.textContent).toBe('Grocery Shopping');
    });

    it('shows a plain string name as-is (a config without localized names)', () => {
        root = render(container, { courses: [{ courseId: 'a', courseName: 'Plain Course', lessonCount: 1, firstLessonId: 'a', mission: null, heroImage: null, tags: [] }], lang: 'es' });

        const title = container.querySelector('[data-testid="friend-course-card"] h2');
        expect(title.textContent).toBe('Plain Course');
    });
});
