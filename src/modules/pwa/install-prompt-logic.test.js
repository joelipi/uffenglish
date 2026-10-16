// modules/pwa/install-prompt-logic.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    STANDALONE_DISPLAY_MODE_QUERY,
    shouldOfferInstall,
    openInstallDialog,
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
