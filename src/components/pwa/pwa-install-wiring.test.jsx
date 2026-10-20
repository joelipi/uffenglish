// components/pwa/pwa-install-wiring.test.jsx
// The install dialog is mounted once in the layout and the entry point lives in
// the home menu — different subtrees, bridged by the registry in
// install-prompt-webonly.js. `@khmyznikov/pwa-install` is mocked so these tests
// never pull the ~142 KB web-component bundle (plus its Lit/inapp-spy deps)
// into jsdom.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('@khmyznikov/pwa-install', () => ({}));

import PWAInstallDialog from './PWAInstallDialog.web.jsx';
import PWAInstallButton from './PWAInstallButton.web.jsx';
import { registerInstallElement, getRegisteredInstallElement } from '../../modules/pwa/install-prompt-webonly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(element); });
    return {
        container,
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    registerInstallElement(null);
    delete window.matchMedia;
    vi.restoreAllMocks();
});

describe('PWAInstallDialog', () => {
    it('mounts the dialog in manual mode, remembering dismissals', () => {
        const { container, unmount } = render(<PWAInstallDialog />);
        const mounted = container.querySelectorAll('pwa-install');
        expect(mounted).toHaveLength(1);
        const element = mounted[0];
        expect(element).toBeTruthy();
        // Manual mode: the dialog never opens itself (the app already shows the
        // guest modal), so the menu entry controls it.
        expect(element.hasAttribute('manual-chrome')).toBe(true);
        expect(element.hasAttribute('manual-apple')).toBe(true);
        expect(element.hasAttribute('use-local-storage')).toBe(true);
        expect(element.getAttribute('manifest-url')).toBe('/manifest.webmanifest');
        unmount();
    });

    it('registers the mounted element for the menu entry, and clears it on unmount', () => {
        const { container, unmount } = render(<PWAInstallDialog />);
        expect(getRegisteredInstallElement()).toBe(container.querySelector('pwa-install'));
        unmount();
        expect(getRegisteredInstallElement()).toBeNull();
    });
});

describe('PWAInstallButton', () => {
    it('renders the localized install entry point', () => {
        const { container, unmount } = render(<PWAInstallButton label="Install app" />);
        const button = container.querySelector('[data-testid="install-app"]');
        expect(button).toBeTruthy();
        expect(button.textContent).toContain('Install app');
        unmount();
    });

    it('installs directly on click (forced panel is the fallback) and closes its host menu first', async () => {
        const install = vi.fn(async () => {});
        const showDialog = vi.fn();
        // A Chromium-shaped element: install() plus the documented events.
        const element = {
            install,
            showDialog,
            isAppleMobilePlatform: false,
            isAppleDesktopPlatform: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        registerInstallElement(element);
        const onBeforeOpen = vi.fn();
        const { container, unmount } = render(
            <PWAInstallButton label="Install app" onBeforeOpen={onBeforeOpen} />
        );
        act(() => { container.querySelector('[data-testid="install-app"]').click(); });
        expect(onBeforeOpen).toHaveBeenCalled();
        // The direct path: the OS prompt, no panel in between.
        expect(install).toHaveBeenCalledTimes(1);
        expect(showDialog).not.toHaveBeenCalled();
        await act(async () => {});
        unmount();
    });

    it('is fail-open when no dialog element is mounted', () => {
        const { container, unmount } = render(<PWAInstallButton label="Install app" />);
        expect(() => {
            act(() => { container.querySelector('[data-testid="install-app"]').click(); });
        }).not.toThrow();
        unmount();
    });

    it('renders nothing inside an already-installed (standalone) app', () => {
        window.matchMedia = () => ({ matches: true });
        const { container, unmount } = render(<PWAInstallButton label="Install app" />);
        expect(container.querySelector('[data-testid="install-app"]')).toBeNull();
        unmount();
    });
});

describe('install wiring source guards', () => {
    it('mounts the dialog once, in the app layout', () => {
        const rootLayout = read('../../routes/RootLayout.jsx');
        expect(rootLayout).toContain("import PWAInstallDialog from '../components/pwa/PWAInstallDialog.web.jsx'");
        expect(rootLayout).toContain('<PWAInstallDialog />');
    });

    it('renders the entry point in the shared app-header menu with platform-aware localized copy', () => {
        const appHeader = read('../layout/AppHeader.web.jsx');
        expect(appHeader).toContain("import PWAInstallButton from '../pwa/PWAInstallButton.web.jsx'");
        expect(appHeader).toContain('<PWAInstallButton');
        // Apple platforms see "Add to Home Screen", everyone else "Install app".
        expect(appHeader).toContain('selectInstallCtaKey');
        expect(appHeader).toContain('readIsApplePlatform');
        // Guests never see install affordances: the menu entry is gated on a
        // real signed-in user, like the notification opt-in below it.
        const buttonAt = appHeader.indexOf('<PWAInstallButton');
        const gateAt = appHeader.lastIndexOf('{registered && (', buttonAt);
        expect(gateAt).toBeGreaterThan(-1);
    });

    it('keeps the heavy web component out of the header subtree', () => {
        // AppHeader.test.jsx renders the whole menu; importing the dialog
        // package there would drag the Lit bundle into jsdom.
        expect(read('PWAInstallButton.web.jsx')).not.toContain('@khmyznikov/pwa-install');
        expect(read('PWAInstallDialog.web.jsx')).toContain("import '@khmyznikov/pwa-install'");
    });

    it('keeps the install rules pure (no React/DOM in the logic module)', () => {
        const logic = read('../../modules/pwa/install-prompt-logic.js');
        expect(logic).not.toContain('from \'react\'');
        expect(logic).not.toContain('window.');
        expect(logic).not.toContain('document.');
    });

    it('ships localized copy for the entry point in every UI language', () => {
        const strings = read('../../data/strings.js');
        const block = strings.slice(strings.indexOf("'pwa_install_cta'"));
        const entry = block.slice(0, block.indexOf('},'));
        for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
            expect(entry, lang).toContain(`${lang}:`);
        }
        expect(entry).toMatch(/[\u0900-\u097F]/); // Hindi (Devanagari)
        expect(entry).toMatch(/[\u0980-\u09FF]/); // Bengali
    });
});
