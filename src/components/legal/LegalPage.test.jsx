import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from './LegalPage.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The app shell hides overflow on html/body (index.html), so the page itself
// must provide a scrollable region or long legal docs are unreadable.
describe('LegalPage scrolling', () => {
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
    });

    const render = () => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(LegalPage, {
                        markdown: '# Title\n\nline one\n\nline two',
                        titleKey: 'legal_privacy',
                    })
                )
            );
        });
    };

    it('renders a flex column shell that owns its scrolling', () => {
        render();
        const scroll = container.querySelector('[data-testid="legal-scroll"]');
        expect(scroll).not.toBeNull();
        const shell = scroll.parentElement;
        expect(shell.style.overflow).toBe('hidden');
        expect(shell.style.display).toBe('flex');
        expect(shell.style.flexDirection).toBe('column');
    });

    it('makes the document region vertically scrollable', () => {
        render();
        const scroll = container.querySelector('[data-testid="legal-scroll"]');
        expect(scroll.style.overflowY).toBe('auto');
        expect(scroll.style.flexGrow || scroll.style.flex).toBeTruthy();
    });

    it('renders the document inside the scroll region', () => {
        render();
        const scroll = container.querySelector('[data-testid="legal-scroll"]');
        expect(scroll.querySelector('[data-testid="legal-document"]')).not.toBeNull();
        expect(scroll.querySelector('h1').textContent).toBe('Title');
    });
});
