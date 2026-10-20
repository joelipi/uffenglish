// The welcome page (/welcome): the topic buttons a learner picks from.
// Rendered with react-dom/client createRoot + act (the repo convention; no
// testing-library is installed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import WelcomePage from './WelcomePage.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TAGS = [
    { tag: 'travel', key: 'travel', courseIds: ['test-api'] },
    { tag: 'family', key: 'family', courseIds: ['friendchain'] },
];

function render(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                MemoryRouter,
                null,
                React.createElement(WelcomePage, { lang: 'en', tags: TAGS, ...props }),
            ),
        );
    });
    return root;
}

describe('WelcomePage', () => {
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

    it('shows the "choose your topic" heading', () => {
        root = render(container, {});

        const heading = container.querySelector('[data-testid="welcome-heading"]');
        expect(heading).not.toBeNull();
        expect(heading.tagName).toBe('H1');
        expect(heading.textContent).toBe('Choose your topic');
    });

    it('localizes the heading', () => {
        root = render(container, { lang: 'es' });

        expect(container.querySelector('[data-testid="welcome-heading"]').textContent).toBe('Elige tu tema');
    });

    it('renders one big button per tag, linking to that tag page', () => {
        root = render(container, {});

        const buttons = Array.from(container.querySelectorAll('[data-testid="welcome-tag-button"]'));
        expect(buttons).toHaveLength(2);
        expect(buttons[0].textContent).toBe('travel');
        expect(buttons[1].textContent).toBe('family');
        expect(buttons[0].getAttribute('href')).toBe('/tags/travel');
        expect(buttons[1].getAttribute('href')).toBe('/tags/family');
    });

    it('shows a spinner while the topics load, and no buttons', () => {
        root = render(container, { tags: [], isLoading: true });

        expect(container.querySelector('[data-testid="welcome-loading"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="welcome-tag-button"]')).toHaveLength(0);
    });

    it('shows the load error, and no buttons', () => {
        root = render(container, { tags: [], isError: true });

        expect(container.querySelector('[data-testid="welcome-error"]').textContent)
            .toBe('Failed to load topics. Please try again later.');
        expect(container.querySelectorAll('[data-testid="welcome-tag-button"]')).toHaveLength(0);
    });

    it('shows the empty message when no topic carries a course', () => {
        root = render(container, { tags: [] });

        expect(container.querySelector('[data-testid="welcome-empty"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="welcome-tag-button"]')).toHaveLength(0);
    });

    it('owns its scrolling: a flex child of the app shell', () => {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height,
        // so the page must not claim a height of its own.
        root = render(container, {});

        const page = container.querySelector('[data-testid="welcome-page"]');
        expect(page.style.flexGrow).toBe('1');
        expect(page.style.minHeight).toBe('0px');
        expect(page.style.height).toBe('');

        const scroll = container.querySelector('[data-testid="welcome-scroll"]');
        expect(scroll.style.overflowY).toBe('auto');
        // The heading stays outside the scroll region, the buttons inside it.
        const shell = page;
        expect(scroll.contains(container.querySelector('[data-testid="welcome-heading"]'))).toBe(false);
        expect(scroll.contains(container.querySelector('[data-testid="welcome-tag-button"]'))).toBe(true);
        expect(shell.contains(scroll)).toBe(true);
    });
});
