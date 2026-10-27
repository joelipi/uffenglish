// Guards the statistics table: the shared definition in the pure logic module
// (plain-English labels + icons + derived values + the friends link, covered
// in modules/profile/profile-stats-logic.test.js), its render on BOTH profile
// pages and on the /home dashboard, the single-line tile layout, and the quiet
// link on the friends tile.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
        expect(source).toContain('<ProfileStats stats={stats} />');
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
        expect(homeScreenSource).toContain('<ProfileStats stats={stats} />');
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

    it('puts the icon, label and value on ONE line (row layout, small padding)', () => {
        const tile = blockFor('.profile-stat-tile {');
        expect(tile).toContain('flex-direction: row');
        expect(tile).toContain('align-items: center');
        const padding = /padding:\s*(\d+)px/.exec(tile);
        expect(Number(padding[1])).toBeLessThanOrEqual(6);
        // The value is pushed to the end of the row.
        expect(blockFor('.profile-stat-value {')).toContain('margin-left: auto');
    });

    it('renders the icons white, like the app\'s other statistics', () => {
        expect(blockFor('.profile-stat-tile i {')).toContain('color: #ffffff');
    });

    it('leaves the friends link undecorated', () => {
        const linkBlock = blockFor('.profile-stat-link,');
        expect(linkBlock).toContain('text-decoration: none');
        expect(linkBlock).toContain('color: #ffffff');
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

    function render(stats) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(ProfileStats, { stats })
                )
            );
        });
    }

    const stats = buildProfileStats({
        completed_dates: [new Date().toLocaleDateString('en-CA')],
        lessons_completed: 7,
        friends: [{ id: 'a' }, { id: 'b' }],
        referrals: 3,
    });

    it('renders one single-line tile per statistic: icon, label, value', () => {
        render(stats);
        const tiles = container.querySelectorAll('.profile-stat-tile');
        expect(tiles).toHaveLength(5);
        for (const tile of tiles) {
            expect(tile.children).toHaveLength(3);
            expect(tile.children[0].tagName).toBe('I');
            expect(tile.children[1].className).toBe('profile-stat-label');
            expect(tile.children[2].className).toBe('profile-stat-value');
        }
        expect(container.querySelector('[data-testid="profile-stat-streak"]').textContent).toBe('Streak1');
        expect(container.querySelector('[data-testid="profile-stat-lessons"]').textContent).toBe('Lessons7');
        expect(container.querySelector('[data-testid="profile-stat-friends"]').textContent).toBe('Friends2');
        expect(container.querySelector('[data-testid="profile-stat-referrals"]').textContent).toBe('Referrals3');
    });

    it('renders the icon class for each statistic', () => {
        render(stats);
        const streak = container.querySelector('[data-testid="profile-stat-streak"] i');
        expect(streak.className).toContain('bi');
        expect(streak.className).toContain('bi-fire');
        const friendIcon = container.querySelector('[data-testid="profile-stat-friends"] i');
        expect(friendIcon.className).toContain('bi-people-fill');
    });

    it('makes ONLY the friends tile a quiet link to /friends', () => {
        render(stats);
        const friends = container.querySelector('[data-testid="profile-stat-friends"]');
        expect(friends.tagName).toBe('A');
        expect(friends.getAttribute('href')).toBe('/friends');
        expect(friends.className).toContain('profile-stat-link');
        for (const id of ['streak', 'lessons', 'referrals', 'daysActive']) {
            const tile = container.querySelector(`[data-testid="profile-stat-${id}"]`);
            expect(tile.tagName, id).toBe('DIV');
        }
    });
});
