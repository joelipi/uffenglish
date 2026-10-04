// Story 039: the profile renders one labelled link per active friend-chain
// lesson. Rendered with react-dom/client createRoot + act (the repo convention;
// no testing-library is installed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Strings from '../../data/strings.js';
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

    it('renders one labelled anchor per active entry, each pointing at its own lesson', () => {
        const links = {
            'friendchain:b': {
                courseId: 'friendchain', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Respond',
            },
            'friendchain:c': {
                courseId: 'friendchain', lessonId: 'c', shareCode: 'code1',
                addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Follow Up',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const anchors = container.querySelectorAll('[data-testid="friend-lesson-link"]');
        expect(anchors).toHaveLength(2);

        const hrefs = Array.from(anchors).map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('https://ultrafastfluency.com/course/friendchain/lesson/b?shareCode=code1');
        expect(hrefs).toContain('https://ultrafastfluency.com/course/friendchain/lesson/c?shareCode=code1');

        const labels = Array.from(anchors).map((a) => a.textContent);
        expect(labels.some((l) => l.includes('Respond'))).toBe(true);
        expect(labels.some((l) => l.includes('Follow Up'))).toBe(true);
    });

    it('falls back to the untitled string when lessonTitle is empty', () => {
        const links = {
            'friendchain:b': {
                courseId: 'friendchain', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: '',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const anchor = container.querySelector('[data-testid="friend-lesson-link"]');
        expect(anchor.textContent).toBe(Strings.get('profile_friend_lesson_link', 'en'));
    });

    it('renders its own countdown per link', () => {
        const links = {
            'friendchain:b': {
                courseId: 'friendchain', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - HOUR), lessonTitle: 'Respond',
            },
        };
        root = renderSection(container, { friendLinks: links, lang: 'en' });

        const countdown = container.querySelector('[data-testid="friend-lesson-link-countdown"]');
        expect(countdown).not.toBeNull();
        expect(countdown.textContent).toMatch(/^Available for 4[67]h \d+m$/);
    });

    it('renders nothing when every entry is expired', () => {
        const links = {
            'friendchain:b': {
                courseId: 'friendchain', lessonId: 'b', shareCode: 'code1',
                addedAt: iso(NOW - 48 * HOUR), lessonTitle: 'Respond',
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
