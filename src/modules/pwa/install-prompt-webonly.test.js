// modules/pwa/install-prompt-webonly.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    readIsStandaloneApp,
    registerInstallElement,
    getRegisteredInstallElement,
    mountInstallElement,
    unmountInstallElement,
} from './install-prompt-webonly.js';
import { STANDALONE_DISPLAY_MODE_QUERY } from './install-prompt-logic.js';

afterEach(() => {
    delete window.matchMedia;
    delete window.navigator.standalone;
    registerInstallElement(null);
    vi.restoreAllMocks();
});

describe('readIsStandaloneApp', () => {
    it('reads false when the browser exposes no display-mode matchMedia (jsdom, old browsers)', () => {
        expect(typeof window.matchMedia).toBe('undefined');
        expect(readIsStandaloneApp()).toBe(false);
    });

    it('reads true when the standalone display mode matches', () => {
        window.matchMedia = vi.fn((query) => ({ matches: query === STANDALONE_DISPLAY_MODE_QUERY }));
        expect(readIsStandaloneApp()).toBe(true);
    });

    it('reads true from iOS Safari navigator.standalone', () => {
        window.navigator.standalone = true;
        expect(readIsStandaloneApp()).toBe(true);
    });

    it('fails closed (not installed) when the media query throws', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        window.matchMedia = () => { throw new Error('media query exploded'); };
        expect(readIsStandaloneApp()).toBe(false);
        expect(error).toHaveBeenCalled();
    });
});

describe('install element registry', () => {
    it('bridges the mounted dialog element to its trigger button', () => {
        expect(getRegisteredInstallElement()).toBeNull();
        const element = { showDialog: vi.fn() };
        registerInstallElement(element);
        expect(getRegisteredInstallElement()).toBe(element);
    });

    it('clears the registration on unmount / a falsy value', () => {
        registerInstallElement({ showDialog: vi.fn() });
        registerInstallElement(null);
        expect(getRegisteredInstallElement()).toBeNull();
        registerInstallElement(undefined);
        expect(getRegisteredInstallElement()).toBeNull();
    });
});

describe('mountInstallElement', () => {
    function host() {
        const div = document.createElement('div');
        document.body.appendChild(div);
        return div;
    }

    it('mounts the dialog with the manual-mode attributes and registers it', () => {
        const container = host();
        const element = mountInstallElement(container, { lang: 'ES' });
        try {
            expect(element).toBeTruthy();
            expect(element.tagName).toBe('PWA-INSTALL');
            expect(element.hasAttribute('manual-chrome')).toBe(true);
            expect(element.hasAttribute('manual-apple')).toBe(true);
            expect(element.hasAttribute('use-local-storage')).toBe(true);
            expect(element.getAttribute('manifest-url')).toBe('/manifest.webmanifest');
            expect(getRegisteredInstallElement()).toBe(element);
        } finally {
            unmountInstallElement(element);
            container.remove();
        }
        expect(getRegisteredInstallElement()).toBeNull();
    });

    it('shows the mapped app locale to the component at connect time', () => {
        // The component reads navigator.language synchronously in
        // connectedCallback, so observing the value during appendChild proves
        // what it saw — regardless of how the bundle implements the read.
        const container = host();
        const seen = [];
        const append = container.appendChild.bind(container);
        container.appendChild = (child) => {
            seen.push(window.navigator.language);
            return append(child);
        };
        try {
            mountInstallElement(container, { lang: 'ES' });
            expect(seen).toEqual(['es']);
        } finally {
            const element = getRegisteredInstallElement();
            if (element) unmountInstallElement(element);
            container.remove();
        }
    });

    it('restores navigator.language after mounting', () => {
        const before = window.navigator.language;
        const container = host();
        try {
            mountInstallElement(container, { lang: 'FR' });
            expect(window.navigator.language).toBe(before);
        } finally {
            const element = getRegisteredInstallElement();
            if (element) unmountInstallElement(element);
            container.remove();
        }
    });

    it('is fail-open when the language property cannot be shadowed', () => {
        const container = host();
        const realDefineProperty = Object.defineProperty;
        // Only the spoof itself fails; every other defineProperty (including
        // jsdom's element machinery) keeps working.
        const defineProperty = vi.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, descriptor) => {
            if (obj === window.navigator && prop === 'language') throw new Error('non-configurable');
            return realDefineProperty(obj, prop, descriptor);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const element = mountInstallElement(container, { lang: 'ES' });
            // Mounts anyway (browser language, today's behaviour) — the dialog
            // must never fail to exist because localization did.
            expect(element).toBeTruthy();
            expect(getRegisteredInstallElement()).toBe(element);
            if (element) unmountInstallElement(element);
        } finally {
            container.remove();
        }
        expect(error).toHaveBeenCalled();
    });

    it('returns null and registers nothing when there is no host', () => {
        expect(mountInstallElement(null, { lang: 'ES' })).toBeNull();
        expect(getRegisteredInstallElement()).toBeNull();
    });
});

describe('unmountInstallElement', () => {
    it('removes the element and clears only its own registration', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
            const element = mountInstallElement(container, { lang: 'en' });
            expect(container.querySelector('pwa-install')).toBe(element);
            unmountInstallElement(element);
            expect(container.querySelector('pwa-install')).toBeNull();
            expect(getRegisteredInstallElement()).toBeNull();
        } finally {
            container.remove();
        }
    });

    it('never throws, even for a missing element or a foreign registration', () => {
        const foreign = { showDialog: () => {} };
        registerInstallElement(foreign);
        expect(() => unmountInstallElement(null)).not.toThrow();
        expect(() => unmountInstallElement(undefined)).not.toThrow();
        expect(getRegisteredInstallElement()).toBe(foreign);
        registerInstallElement(null);
    });
});
