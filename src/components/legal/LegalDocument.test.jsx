import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LegalDocument from './LegalDocument.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE = [
    '# My Title',
    '',
    'Some **bold** and *italic* and `code` with a [link](./privacy-policy.md).',
    '',
    '- item one',
    '- item two',
    '',
    '| H1 | H2 |',
    '|---|---|',
    '| a | b |',
    '',
    '---',
].join('\n');

describe('LegalDocument', () => {
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
                    React.createElement(LegalDocument, { markdown: SAMPLE })
                )
            );
        });
    };

    it('renders headings, inline formatting and code', () => {
        render();
        expect(container.querySelector('h1').textContent).toBe('My Title');
        expect(container.querySelector('strong').textContent).toBe('bold');
        expect(container.querySelector('em').textContent).toBe('italic');
        expect(container.querySelector('code').textContent).toBe('code');
    });

    it('rewrites legal .md links to SPA routes', () => {
        render();
        expect(container.querySelector('a').getAttribute('href')).toBe('/privacy');
    });

    it('renders lists, tables and thematic breaks', () => {
        render();
        expect(container.querySelectorAll('ul li')).toHaveLength(2);
        expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['H1', 'H2']);
        expect([...container.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['a', 'b']);
        expect(container.querySelector('hr')).not.toBeNull();
    });

    it('never leaves raw markdown markers in the output text', () => {
        render();
        expect(container.textContent).not.toContain('**');
        expect(container.textContent).not.toContain('](');
    });
});
