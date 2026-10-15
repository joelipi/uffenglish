import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LegalFooter from './LegalFooter.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LegalFooter', () => {
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
                    React.createElement(LegalFooter, props)
                )
            );
        });
    };

    const links = () => [...container.querySelectorAll('a')];

    it('links to /privacy and /terms', () => {
        render();
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/terms']);
        expect(links().map((a) => a.textContent)).toEqual(['Privacy Policy', 'Terms of Service']);
    });

    it('localizes the labels', () => {
        render({ lang: 'es' });
        expect(links().map((a) => a.textContent)).toEqual(['Política de Privacidad', 'Términos del Servicio']);
    });
});
