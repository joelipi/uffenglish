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
import { appStore } from '../../modules/store/store.js';
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
    appStore.getState().setGuestNativeLanguage(null);
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

    it('re-mounts the dialog when the app language changes, so it re-localizes', () => {
        const { container, unmount } = render(<PWAInstallDialog />);
        const first = container.querySelector('pwa-install');
        expect(first).toBeTruthy();

        act(() => {
            appStore.getState().setGuestNativeLanguage('ES');
        });
        const remounted = container.querySelectorAll('pwa-install');
        expect(remounted).toHaveLength(1);
        expect(remounted[0]).not.toBe(first);
        // The registry tracks the live element, never the removed one.
        expect(getRegisteredInstallElement()).toBe(remounted[0]);
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

    it('opens the registered dialog and closes its host menu first', () => {
        const showDialog = vi.fn();
        registerInstallElement({ showDialog });
        const onBeforeOpen = vi.fn();
        const { container, unmount } = render(
            <PWAInstallButton label="Install app" onBeforeOpen={onBeforeOpen} />
        );
        act(() => { container.querySelector('[data-testid="install-app"]').click(); });
        expect(onBeforeOpen).toHaveBeenCalled();
        expect(showDialog).toHaveBeenCalledWith(false);
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

    it('renders the entry point in the home menu with localized copy', () => {
        const homeScreen = read('../homescreen/HomeScreen.jsx');
        expect(homeScreen).toContain("import PWAInstallButton from '../pwa/PWAInstallButton.web.jsx'");
        expect(homeScreen).toContain('<PWAInstallButton');
        expect(homeScreen).toContain("Strings.get('pwa_install_cta', lang)");
    });

    it('keeps the heavy web component out of the home screen subtree', () => {
        // HomeScreen.test.jsx renders the whole menu; importing the dialog
        // package there would drag the Lit bundle into jsdom.
        expect(read('PWAInstallButton.web.jsx')).not.toContain('@khmyznikov/pwa-install');
        expect(read('PWAInstallDialog.web.jsx')).toContain("import '@khmyznikov/pwa-install'");
    });

    it('mounts the dialog imperatively in the app language (no pwa-install JSX)', () => {
        // The component must be created imperatively so its connectedCallback —
        // where it reads navigator.language once — runs inside the spoof window.
        // A `<pwa-install>` JSX tag would mount at RootLayout's pace, in whatever
        // language the browser happens to have.
        const dialog = read('PWAInstallDialog.web.jsx');
        expect(dialog).not.toContain('<pwa-install');
        expect(dialog).toContain('mountInstallElement(');
        expect(dialog).toContain('guestNativeLanguage');
        expect(dialog).toContain('native_language');
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
