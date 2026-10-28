import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HeroHeadline from './HeroHeadline.jsx';
import {
    HERO_REDUCED_MOTION_QUERY,
    heroHeadlineText,
    heroRelations,
} from '../../modules/home/hero-headline-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HeroHeadline', () => {
    let container;
    let root;
    let log;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        log.mockRestore();
        vi.useRealTimers();
        delete window.matchMedia;
    });

    const render = (props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(HeroHeadline, props));
        });
    };

    const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);
    const items = (testid) => [...q(testid).querySelectorAll('.uff-hero-rot__item')];
    const activeText = (testid) => items(testid).find((el) => el.classList.contains('is-on'))?.textContent;

    it('renders the whole sentence and the three rotating slots', () => {
        render();
        expect(q('hero-headline-accessible').textContent).toBe(heroHeadlineText('en', 0));
        expect(q('hero-slot-relation')).not.toBeNull();
        expect(q('hero-slot-friendLevel')).not.toBeNull();
        expect(q('hero-slot-yourLevel')).not.toBeNull();
        // Every candidate stays in the DOM, stacked in one cell: a short word
        // pads inside the cell and the sentence never reflows.
        expect(items('hero-slot-relation')).toHaveLength(heroRelations('en').length);
        expect(items('hero-slot-friendLevel')).toHaveLength(7);
        expect(items('hero-slot-yourLevel')).toHaveLength(7);
    });

    it('shows exactly one value per slot, starting at the first', () => {
        render();
        for (const slot of ['hero-slot-relation', 'hero-slot-friendLevel', 'hero-slot-yourLevel']) {
            expect(items(slot).filter((el) => el.classList.contains('is-on')), slot).toHaveLength(1);
        }
        expect(activeText('hero-slot-relation')).toBe('your mom');
        expect(activeText('hero-slot-friendLevel')).toBe('A0');
        expect(activeText('hero-slot-yourLevel')).toBe('B1');
    });

    it('keeps the visual stack out of the accessibility tree', () => {
        render();
        // Assistive tech reads the one hidden sentence, never every candidate
        // word. The hidden copy is still real text (no aria-label trick).
        expect(q('hero-headline-visual').getAttribute('aria-hidden')).toBe('true');
        expect(q('hero-headline-accessible').getAttribute('aria-hidden')).toBeNull();
        expect(q('hero-headline-accessible').className).toContain('visually-hidden');
    });

    it('advances every slot one step per interval', () => {
        vi.useFakeTimers();
        render();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(activeText('hero-slot-relation')).toBe(heroRelations('en')[1]);
        expect(activeText('hero-slot-friendLevel')).toBe('A1');
        expect(activeText('hero-slot-yourLevel')).toBe('B2');
        act(() => { vi.advanceTimersByTime(1000); });
        expect(activeText('hero-slot-relation')).toBe(heroRelations('en')[2]);
    });

    it('wraps each slot on its own length', () => {
        vi.useFakeTimers();
        render();
        // Seven steps: the seven-band slots are back at their first value while
        // the six relationships have moved on to the second.
        act(() => { vi.advanceTimersByTime(7000); });
        expect(activeText('hero-slot-relation')).toBe(heroRelations('en')[1]);
        expect(activeText('hero-slot-friendLevel')).toBe('A0');
        expect(activeText('hero-slot-yourLevel')).toBe('B1');
    });

    it('does not rotate under prefers-reduced-motion', () => {
        window.matchMedia = vi.fn((query) => ({ matches: query === HERO_REDUCED_MOTION_QUERY }));
        vi.useFakeTimers();
        render();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(activeText('hero-slot-relation')).toBe('your mom');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rotates when the browser reports motion is welcome', () => {
        window.matchMedia = vi.fn((query) => ({ matches: query !== HERO_REDUCED_MOTION_QUERY }));
        vi.useFakeTimers();
        render();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(activeText('hero-slot-relation')).toBe(heroRelations('en')[1]);
    });

    it('does not rotate when the interval is switched off', () => {
        vi.useFakeTimers();
        render({ intervalMs: 0 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears its interval on unmount', () => {
        vi.useFakeTimers();
        render();
        expect(vi.getTimerCount()).toBe(1);
        act(() => root.unmount());
        root = null;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('localizes through the language code it is given', () => {
        render({ lang: 'es' });
        expect(q('hero-headline-accessible').textContent).toBe(
            'Practica inglés 🗣️ en 5 min con tu mamá, aunque sea A0 y tú B1 — ¡sin estar conectados al mismo tiempo!',
        );
        expect(activeText('hero-slot-relation')).toBe('tu mamá');
    });

    it('falls back to English for a language the headline does not carry', () => {
        render({ lang: 'de' });
        expect(q('hero-headline-accessible').textContent).toBe(heroHeadlineText('en', 0));
    });

    it('logs when it starts rotating and when it stays still', () => {
        vi.useFakeTimers();
        render();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('rotating every'));
        act(() => root.unmount());
        root = null;
        render({ intervalMs: 0 });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('rotation off'));
    });
});
