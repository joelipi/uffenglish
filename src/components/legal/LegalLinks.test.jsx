// Task 1 (story 050): the shared LegalLinks component — two safe new-tab links
// to the public legal pages, localized labels, small text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LegalLinks from './LegalLinks.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LegalLinks', () => {
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

    const render = (props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(LegalLinks, props)
                )
            );
        });
    };

    const linksEl = () => container.querySelector('[data-testid="legal-links"]');
    const anchors = () => [...container.querySelectorAll('[data-testid="legal-links"] a')];

    it('renders exactly two links to /privacy and /terms', () => {
        render();
        expect(linksEl()).not.toBeNull();
        expect(anchors()).toHaveLength(2);
        expect(anchors().map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/terms']);
        expect(anchors().map((a) => a.textContent)).toEqual(['Privacy Policy', 'Terms of Service']);
    });

    it('opens each link in a new tab safely', () => {
        render();
        for (const a of anchors()) {
            expect(a.getAttribute('target')).toBe('_blank');
            expect(a.getAttribute('rel')).toContain('noopener');
            expect(a.getAttribute('rel')).toContain('noreferrer');
        }
    });

    it('uses 12px small text on the container', () => {
        render();
        expect(linksEl().style.fontSize).toBe('12px');
    });

    it('localizes the labels (es)', () => {
        render({ lang: 'es' });
        expect(anchors().map((a) => a.textContent))
            .toEqual(['Política de Privacidad', 'Términos del Servicio']);
    });

    it('localizes the labels (pt)', () => {
        render({ lang: 'pt' });
        expect(anchors().map((a) => a.textContent))
            .toEqual(['Política de Privacidade', 'Termos de Serviço']);
    });

    it('falls back to English for an unsupported locale (de)', () => {
        render({ lang: 'de' });
        expect(anchors().map((a) => a.textContent))
            .toEqual(['Privacy Policy', 'Terms of Service']);
    });
});
