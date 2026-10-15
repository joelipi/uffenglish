// components/pwa/PWAInstallBanner.test.jsx
// The non-dismissible install banner for /home, /profile and /courses: shown
// to signed-in users outside the installed PWA, never to guests, with
// Apple-specific wording on Apple platforms. Tapping it opens the same
// install dialog as the menu entry point.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import PWAInstallBanner from './PWAInstallBanner.web.jsx';
import { registerInstallElement } from '../../modules/pwa/install-prompt-webonly.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(MemoryRouter, null, element));
    });
    return {
        container,
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

const setNavigator = ({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) => {
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
};

const IPHONE = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    platform: 'iPhone',
    maxTouchPoints: 5,
};
const WINDOWS = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
    maxTouchPoints: 0,
};

afterEach(() => {
    registerInstallElement(null);
    delete window.matchMedia;
    delete window.navigator.standalone;
    vi.restoreAllMocks();
});

describe('PWAInstallBanner', () => {
    it('renders the generic install copy with IMPORTANT! for signed-in users', () => {
        setNavigator(WINDOWS);
        const { container, unmount } = render(<PWAInstallBanner lang="en" userId="user-1" />);
        const banner = container.querySelector('[data-testid="pwa-install-banner"]');
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain('IMPORTANT!');
        expect(banner.textContent).toContain('Install this app NOW');
        expect(banner.textContent).toContain('No credit card');
        unmount();
    });

    it('renders the Home Screen copy on Apple platforms', () => {
        setNavigator(IPHONE);
        const { container, unmount } = render(<PWAInstallBanner lang="en" userId="user-1" />);
        const banner = container.querySelector('[data-testid="pwa-install-banner"]');
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain('Home Screen NOW');
        expect(banner.textContent).not.toContain('Install this app NOW');
        unmount();
    });

    it('localizes the banner copy', () => {
        setNavigator(WINDOWS);
        const { container, unmount } = render(<PWAInstallBanner lang="es" userId="user-1" />);
        const banner = container.querySelector('[data-testid="pwa-install-banner"]');
        expect(banner.textContent).toContain('¡IMPORTANTE!');
        expect(banner.textContent).toContain('Instala esta aplicación AHORA');
        unmount();
    });

    it('takes roughly the top quarter of the screen and cannot be dismissed', () => {
        setNavigator(WINDOWS);
        const { container, unmount } = render(<PWAInstallBanner lang="en" userId="user-1" />);
        const banner = container.querySelector('[data-testid="pwa-install-banner"]');
        expect(banner.style.minHeight).toBe('25dvh');
        // The banner itself is the only control: no dismiss/close affordance.
        expect(container.querySelectorAll('button')).toHaveLength(1);
        unmount();
    });

    it('opens the registered install dialog on tap', () => {
        setNavigator(WINDOWS);
        const showDialog = vi.fn();
        registerInstallElement({ showDialog });
        const { container, unmount } = render(<PWAInstallBanner lang="en" userId="user-1" />);
        act(() => { container.querySelector('[data-testid="pwa-install-banner"]').click(); });
        expect(showDialog).toHaveBeenCalledWith(false);
        unmount();
    });

    it('renders nothing for guests, anonymous users and installed apps', () => {
        setNavigator(WINDOWS);
        for (const userId of ['guest', null, undefined]) {
            const { container, unmount } = render(<PWAInstallBanner lang="en" userId={userId} />);
            expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
            unmount();
        }
        window.matchMedia = () => ({ matches: true });
        const { container, unmount } = render(<PWAInstallBanner lang="en" userId="user-1" />);
        expect(container.querySelector('[data-testid="pwa-install-banner"]')).toBeNull();
        unmount();
    });
});

// Source guards (kept here — not in pwa-install-wiring.test.jsx — because that
// file imports the missing `@khmyznikov/pwa-install` package through the
// dialog component and cannot even be collected in this sandbox).
describe('PWAInstallBanner wiring source guards', () => {
    it('pins the install banner to /home, /profile and /courses', () => {
        for (const [file, probe] of [
            ['../homescreen/HomeScreen.jsx', '<PWAInstallBanner lang={lang} userId={viewerId} />'],
            ['../profile/UserProfile.jsx', '<PWAInstallBanner lang={lang} userId={profile?.$id} />'],
            ['../courses/CourseListings.jsx', '<PWAInstallBanner lang={lang} userId={userId} />'],        ]) {
            const source = read(file);
            expect(source, `${file} import`).toContain("import PWAInstallBanner from '../pwa/PWAInstallBanner.web.jsx'");
            expect(source, `${file} render`).toContain(probe);
        }
    });

    it('ships localized Apple and banner copy in every UI language', () => {
        const strings = read('../../data/strings.js');
        for (const key of ['pwa_install_cta_apple', 'pwa_banner_title', 'pwa_banner_body_install', 'pwa_banner_body_apple']) {
            const from = strings.indexOf(`'${key}'`);
            expect(from, key).toBeGreaterThan(-1);
            const entry = strings.slice(from, strings.indexOf('},', from));
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                expect(entry, `${key}/${lang}`).toContain(`${lang}:`);
            }
            // Real Hindi and Bengali script, not English placeholders.
            expect(entry, `${key} hi`).toMatch(/[\u0900-\u097F]/);
            expect(entry, `${key} bn`).toMatch(/[\u0980-\u09FF]/);
        }
    });
});
