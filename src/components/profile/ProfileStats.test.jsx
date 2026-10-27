// Guards the statistics table: the shared definition in the pure logic module
// (icons + label keys + derived values, covered in
// modules/profile/profile-stats-logic.test.js), its render on BOTH profile
// pages and on the /home dashboard, and the two-tiles-per-row styling that
// keeps it a compact strip.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { get, strings } from '../../data/strings.js';
import { buildProfileStats } from '../../modules/profile/profile-stats-logic.js';
import ProfileStats from './ProfileStats.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(__dirname, ...parts), 'utf8');
const userProfileSource = read('UserProfile.jsx');
const publicProfileSource = read('PublicProfile.jsx');
const homeScreenSource = read('..', 'homescreen', 'HomeScreen.jsx');
const appCss = read('..', '..', 'assets', 'css', 'app.css');

describe.each([
    ['UserProfile.jsx', userProfileSource],
    ['PublicProfile.jsx', publicProfileSource],
])('%s statistics table', (_name, source) => {
    it('builds the table from the profile via the shared logic module', () => {
        expect(source).toContain('buildProfileStats(profile)');
    });

    it('renders it with the shared ProfileStats component', () => {
        expect(source).toContain("import ProfileStats from './ProfileStats.jsx'");
        expect(source).toContain('<ProfileStats stats={stats} lang={lang} />');
    });

    it('no longer hand-rolls the rows inline', () => {
        // The five label/value rows live in ProfileStats now; an inline copy
        // here would drift from the icons and the home dashboard.
        expect(source).not.toContain('Strings.get(\'profile_streak\'');
        expect(source).not.toContain('Strings.get(\'profile_friend_count\'');
        expect(source).not.toContain('Strings.get(\'profile_referrals\'');
    });
});

describe('HomeScreen statistics table', () => {
    it('renders the shared table in a visible block', () => {
        expect(homeScreenSource).toContain('data-testid="home-stats"');
        expect(homeScreenSource).toContain('<ProfileStats stats={stats} lang={lang} />');
    });

    it('derives the home values through buildHomeStats', () => {
        expect(homeScreenSource).toContain('buildHomeStats(');
    });

    it('keeps the statistics above the install banners and the course list', () => {
        const statsIndex = homeScreenSource.indexOf('data-testid="home-stats"');
        const bannerIndex = homeScreenSource.indexOf('<PWAInstallBanner');
        const coursesIndex = homeScreenSource.indexOf('<FriendCoursesView');
        expect(statsIndex).toBeGreaterThan(-1);
        expect(statsIndex).toBeLessThan(bannerIndex);
        expect(statsIndex).toBeLessThan(coursesIndex);
    });
});

describe('statistics table styling', () => {
    const blockFor = (selector) => {
        const start = appCss.indexOf(selector);
        expect(start, `${selector} missing from app.css`).toBeGreaterThan(-1);
        const open = appCss.indexOf('{', start);
        const close = appCss.indexOf('}', open);
        return appCss.slice(start, close + 1);
    };

    it('lays the tiles out two per row', () => {
        const grid = blockFor('.profile-stats-grid {');
        expect(grid).toContain('display: grid');
        expect(grid).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    });

    it('styles the tile icon, value and label', () => {
        expect(blockFor('.profile-stat-tile {')).toContain('flex-direction: column');
        expect(blockFor('.profile-stat-tile i {')).toContain('font-size');
        expect(blockFor('.profile-stat-value {')).toContain('font-weight: 700');
        expect(blockFor('.profile-stat-label {')).toContain('font-size');
    });
});

describe('ProfileStats rendering', () => {
    let container;
    let root;

    afterEach(() => {
        if (root) act(() => root.unmount());
        container?.remove();
        root = null;
    });

    function render(stats, lang) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(ProfileStats, { stats, lang }));
        });
    }

    const stats = buildProfileStats({
        completed_dates: [new Date().toLocaleDateString('en-CA')],
        lessons_completed: 7,
        friends: [{ id: 'a' }, { id: 'b' }],
        referrals: 3,
    });

    it('renders one tile per statistic with its value and label', () => {
        render(stats, 'en');
        const tiles = container.querySelectorAll('.profile-stat-tile');
        expect(tiles).toHaveLength(5);
        expect(container.querySelector('[data-testid="profile-stat-streak"]').textContent)
            .toContain('1');
        expect(container.querySelector('[data-testid="profile-stat-lessons"]').textContent)
            .toContain('7');
        expect(container.querySelector('[data-testid="profile-stat-friends"]').textContent)
            .toContain('2');
        expect(container.querySelector('[data-testid="profile-stat-referrals"]').textContent)
            .toContain('3');
        expect(container.textContent).toContain(strings.profile_streak.en);
        expect(container.textContent).toContain(strings.profile_days_active.en);
    });

    it('renders the icon class for each statistic', () => {
        render(stats, 'en');
        const streak = container.querySelector('[data-testid="profile-stat-streak"] i');
        expect(streak.className).toContain('bi');
        expect(streak.className).toContain('bi-fire');
        const friendIcon = container.querySelector('[data-testid="profile-stat-friends"] i');
        expect(friendIcon.className).toContain('bi-people-fill');
    });

    it('localizes the labels to the learner language', () => {
        render(stats, 'es');
        expect(container.textContent).toContain(strings.profile_streak.es);
        expect(container.textContent).not.toContain(strings.profile_streak.en);
    });
});

describe('profile statistics labels', () => {
    it.each([
        ['profile_streak', 'Streak'],
        ['profile_friend_count', 'Friends'],
        ['profile_referrals', 'Referrals'],
    ])('%s has the exact English label', (key, en) => {
        expect(strings[key].en).toBe(en);
    });

    it.each(['profile_streak', 'profile_friend_count', 'profile_referrals'])(
        '%s carries es/pt/fr/hi/bn values', (key) => {
            for (const lang of ['es', 'pt', 'fr', 'hi', 'bn']) {
                expect(strings[key][lang], `${key}/${lang}`).toBeTruthy();
            }
            expect(get(`missing_${key}`, 'en')).toBe(`missing_${key}`);
        }
    );
});
