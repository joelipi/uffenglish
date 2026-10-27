// Guards the lesson top-bar stats: the trophy icon and the total-days counter
// that used to sit next to the progress bar are gone; the daily streak (flame)
// and the compact notification bell remain.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appStore } from '../../modules/store/store.js';

// The real bell pulls in TanStack Query and the notifications API; the top-bar
// stats are what is under test, so the bell is stubbed.
vi.mock('../homescreen/NotificationsBell.web.jsx', () => ({
    default: () => React.createElement('span', { 'data-testid': 'bell' }),
}));

import ActivityStats from './ActivityStats.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'ActivityStats.jsx'), 'utf8');

describe('ActivityStats source', () => {
    it('renders no trophy icon and no days counter', () => {
        expect(source).not.toContain('bi-trophy');
        expect(source).not.toContain('dayCountSpan');
        expect(source).not.toContain('Total Days Learned');
    });

    it('does not subscribe to the day count any more', () => {
        expect(source).not.toContain('state.dayCount');
    });

    it('keeps the streak (flame) and the compact bell', () => {
        expect(source).toContain('bi bi-fire');
        expect(source).toContain('streakCountSpan');
        expect(source).toContain('<NotificationsBell userId={userId} lang={lang} compact />');
    });
});

describe('ActivityStats rendering', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        appStore.setState({ currentStreak: 0, dayCount: 0, isLoggedIn: false, userData: null });
    });

    function render() {
        act(() => {
            root.render(React.createElement(ActivityStats));
        });
    }

    it('shows the streak value and nothing for the removed days counter', () => {
        appStore.setState({ currentStreak: 4, dayCount: 12, isLoggedIn: false, userData: null });
        render();

        expect(container.querySelector('.bi-fire')).not.toBeNull();
        expect(container.querySelector('#streakCountSpan').textContent).toBe('4');
        expect(container.querySelector('.bi-trophy-fill')).toBeNull();
        expect(container.querySelector('#dayCountSpan')).toBeNull();
        expect(container.textContent).not.toContain('12');
    });

    it('renders the compact bell only for a registered viewer', () => {
        appStore.setState({ currentStreak: 1, isLoggedIn: false, userData: null });
        render();
        expect(container.querySelector('[data-testid="bell"]')).toBeNull();

        act(() => {
            appStore.setState({ isLoggedIn: true, userData: { $id: 'u1', native_language: 'en' } });
        });
        expect(container.querySelector('[data-testid="bell"]')).not.toBeNull();
    });
});
