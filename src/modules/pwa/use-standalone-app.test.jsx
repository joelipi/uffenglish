// The install banner/menu entry must disappear the moment the app is
// installed — including mid-session, where a one-shot read would leave it
// stuck on screen until a reload.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStandaloneApp } from './use-standalone-app.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const setStandalone = (on) => {
    window.matchMedia = vi.fn((q) => ({ matches: on && q.includes('display-mode') }));
};

function Probe() {
    const isStandalone = useStandaloneApp();
    return <span data-testid="probe">{String(isStandalone)}</span>;
}

describe('useStandaloneApp', () => {
    beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        delete window.matchMedia;
        root = null;
    });

    const render = () => {
        root = createRoot(container);
        act(() => { root.render(<Probe />); });
        return container.querySelector('[data-testid="probe"]').textContent;
    };

    it('reports the current state on mount', () => {
        setStandalone(false);
        expect(render()).toBe('false');
        setStandalone(true);
        root = createRoot(container);
        act(() => { root.render(<Probe />); });
        expect(container.querySelector('[data-testid="probe"]').textContent).toBe('true');
    });

    it('updates when appinstalled fires mid-session (no reload)', () => {
        setStandalone(false);
        expect(render()).toBe('false');
        setStandalone(true);
        act(() => { window.dispatchEvent(new Event('appinstalled')); });
        expect(container.querySelector('[data-testid="probe"]').textContent).toBe('true');
    });

    it('updates when the user returns to a tab left open across the install', () => {
        setStandalone(false);
        expect(render()).toBe('false');
        setStandalone(true);
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(container.querySelector('[data-testid="probe"]').textContent).toBe('true');
    });

    it('stops listening after unmount', () => {
        setStandalone(false);
        render();
        act(() => root.unmount());
        root = null;
        setStandalone(true);
        // Must not throw or update anything after unmount.
        expect(() => { window.dispatchEvent(new Event('appinstalled')); }).not.toThrow();
    });
});
