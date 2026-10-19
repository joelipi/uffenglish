// modules/pwa/install-prompt-logic.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    STANDALONE_DISPLAY_MODE_QUERY,
    shouldOfferInstall,
    openInstallDialog,
    requestInstall,
    isApplePlatform,
    selectInstallCtaKey,
    selectInstallBannerBodyKey,
    shouldShowInstallBanner,
} from './install-prompt-logic.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('shouldOfferInstall', () => {
    it('offers the install entry point when the app is not installed', () => {
        expect(shouldOfferInstall({ isStandalone: false })).toBe(true);
        expect(shouldOfferInstall({})).toBe(true);
        expect(shouldOfferInstall()).toBe(true);
    });

    it('hides the entry point inside an already-installed (standalone) app', () => {
        expect(shouldOfferInstall({ isStandalone: true })).toBe(false);
    });
});

describe('openInstallDialog', () => {
    it('asks the registered install element to open its dialog, forced by default', () => {
        const showDialog = vi.fn();
        expect(openInstallDialog({ showDialog })).toBe(true);
        // Force is REQUIRED: the element renders only when
        // `isInstallAvailable && !isDialogHidden`, and `showDialog(false)`
        // leaves `isInstallAvailable` false — the panel then keeps its
        // `opacity: 0; visibility: hidden` base styles and nothing appears.
        expect(showDialog).toHaveBeenCalledWith(true);
    });

    it('passes force through so the dialog can open without a native prompt', () => {
        const showDialog = vi.fn();
        expect(openInstallDialog({ showDialog }, { force: true })).toBe(true);
        expect(showDialog).toHaveBeenCalledWith(true);
        const other = vi.fn();
        expect(openInstallDialog({ showDialog: other }, { force: false })).toBe(true);
        expect(other).toHaveBeenCalledWith(false);
    });

    it('is fail-open for a missing, un-upgraded or broken element', () => {
        expect(openInstallDialog(null)).toBe(false);
        expect(openInstallDialog(undefined)).toBe(false);
        expect(openInstallDialog({})).toBe(false);
        expect(openInstallDialog({ showDialog: 'not-a-function' })).toBe(false);

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = () => { throw new Error('dialog exploded'); };
        expect(openInstallDialog({ showDialog: boom })).toBe(false);
        expect(error).toHaveBeenCalled();
    });
});

describe('requestInstall', () => {
    // A stand-in for <pwa-install>: the documented events plus install()/
    // showDialog(). `install()` resolves undefined either way and reports its
    // outcome through those events, exactly like the real element.
    const makeElement = ({ apple = false, onInstall } = {}) => {
        const listeners = new Map();
        return {
            isAppleMobilePlatform: apple,
            isAppleDesktopPlatform: false,
            installed: false,
            shown: false,
            install: vi.fn(async () => {
                if (onInstall) onInstall('pwa-install-fail-event');
            }),
            showDialog: vi.fn(function show() { this.shown = true; }),
            addEventListener: vi.fn((type, fn) => {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            }),
            removeEventListener: vi.fn((type, fn) => {
                const arr = listeners.get(type) || [];
                const i = arr.indexOf(fn);
                if (i >= 0) arr.splice(i, 1);
            }),
            emit(type) { (listeners.get(type) || []).slice().forEach((fn) => fn({ type })); },
        };
    };

    it('installs directly on Chromium and never opens the panel', async () => {
        const el = makeElement({ onInstall: () => queueMicrotask(() => {}) });
        const pending = requestInstall(el);
        el.emit('pwa-user-choice-result-event');
        await expect(pending).resolves.toEqual({ ok: true, route: 'install' });
        expect(el.install).toHaveBeenCalledTimes(1);
        expect(el.showDialog).not.toHaveBeenCalled();
    });

    it('falls back to the forced panel when no install backend exists', async () => {
        const el = makeElement({ onInstall: (type) => queueMicrotask(() => el.emit(type)) });
        const pending = requestInstall(el);
        await expect(pending).resolves.toEqual({ ok: true, route: 'panel', reason: 'no-backend' });
        expect(el.showDialog).toHaveBeenCalledWith(true);
    });

    it('shows the panel on Apple without calling install()', async () => {
        const el = makeElement({ apple: true });
        await expect(requestInstall(el)).resolves.toEqual({
            ok: true, route: 'panel', reason: 'apple-instructions',
        });
        expect(el.install).not.toHaveBeenCalled();
        expect(el.showDialog).toHaveBeenCalledWith(true);
    });

    it('falls back to the panel when install() throws', async () => {
        const el = makeElement();
        el.install = vi.fn(() => { throw new Error('boom'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(requestInstall(el)).resolves.toEqual({
            ok: true, route: 'panel', reason: 'no-backend',
        });
        expect(el.showDialog).toHaveBeenCalledWith(true);
        expect(error).toHaveBeenCalled();
    });

    it('degrades to the panel when the element cannot install directly', async () => {
        // No install()/addEventListener, but the panel still works.
        const inert = { showDialog: vi.fn() };
        await expect(requestInstall(inert)).resolves.toEqual({
            ok: true, route: 'panel', reason: 'no-install-method',
        });
        expect(inert.showDialog).toHaveBeenCalledWith(true);
    });

    it('reports no route when there is no element at all', async () => {
        await expect(requestInstall(null)).resolves.toEqual({
            ok: false, route: 'none', reason: 'no-install-method',
        });
    });

    it('removes its listeners so a later click is not resolved by this one', async () => {
        const el = makeElement({ onInstall: (type) => queueMicrotask(() => el.emit(type)) });
        await requestInstall(el);
        expect(el.removeEventListener).toHaveBeenCalledWith('pwa-install-fail-event', expect.any(Function));
        expect(el.removeEventListener).toHaveBeenCalledWith('pwa-user-choice-result-event', expect.any(Function));
    });
});

describe('STANDALONE_DISPLAY_MODE_QUERY', () => {
    it('is the standard installed-PWA media query', () => {
        expect(STANDALONE_DISPLAY_MODE_QUERY).toBe('(display-mode: standalone)');
    });
});

describe('isApplePlatform', () => {
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const IPADOS_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    const DESKTOP_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';
    const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0';
    const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0';

    it('detects iPhone and iPad user agents', () => {
        expect(isApplePlatform({ userAgent: IPHONE_UA, platform: 'iPhone' })).toBe(true);
        expect(isApplePlatform({ userAgent: IPAD_UA, platform: 'iPad' })).toBe(true);
    });

    it('detects desktop Mac and iPadOS reporting a desktop Mac UA', () => {
        expect(isApplePlatform({ userAgent: IPADOS_DESKTOP_UA, platform: 'MacIntel' })).toBe(true);
        expect(isApplePlatform({ userAgent: DESKTOP_MAC_UA, platform: 'MacIntel' })).toBe(true);
    });

    it('rejects Android, Windows and unknown platforms', () => {
        expect(isApplePlatform({ userAgent: ANDROID_UA, platform: 'Linux armv8l' })).toBe(false);
        expect(isApplePlatform({ userAgent: WINDOWS_UA, platform: 'Win32' })).toBe(false);
        expect(isApplePlatform({})).toBe(false);
        expect(isApplePlatform()).toBe(false);
    });
});

describe('selectInstallCtaKey / selectInstallBannerBodyKey', () => {
    it('uses the Apple wording only on Apple platforms', () => {
        expect(selectInstallCtaKey({ isApple: true })).toBe('pwa_install_cta_apple');
        expect(selectInstallCtaKey({ isApple: false })).toBe('pwa_install_cta');
        expect(selectInstallCtaKey({})).toBe('pwa_install_cta');
        expect(selectInstallBannerBodyKey({ isApple: true })).toBe('pwa_banner_body_apple');
        expect(selectInstallBannerBodyKey({ isApple: false })).toBe('pwa_banner_body_install');
        expect(selectInstallBannerBodyKey()).toBe('pwa_banner_body_install');
    });
});

describe('shouldShowInstallBanner', () => {
    it('shows for signed-in users outside the installed PWA', () => {
        expect(shouldShowInstallBanner({ isStandalone: false, userId: 'user-1' })).toBe(true);
    });

    it('hides for guests, anonymous users and inside the installed PWA', () => {
        expect(shouldShowInstallBanner({ isStandalone: false, userId: 'guest' })).toBe(false);
        expect(shouldShowInstallBanner({ isStandalone: false, userId: null })).toBe(false);
        expect(shouldShowInstallBanner({ isStandalone: false })).toBe(false);
        expect(shouldShowInstallBanner({ isStandalone: true, userId: 'user-1' })).toBe(false);
    });
});
