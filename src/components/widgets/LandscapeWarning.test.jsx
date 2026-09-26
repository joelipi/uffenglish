import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LandscapeWarning from './LandscapeWarning.web.jsx';
import { appStore } from '../../modules/store/store.js';
import { get } from '../../data/strings.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const DESKTOP_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

const setNavigator = ({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) => {
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
};

const setViewport = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

describe('LandscapeWarning.web.jsx', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        appStore.setState({ userData: null });
        setNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
        setViewport(844, 390);
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        if (root) {
            await act(async () => {
                root.unmount();
            });
            root = null;
        }
        container.remove();
        vi.restoreAllMocks();
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });

    const renderWarning = async () => {
        root = createRoot(container);
        await act(async () => {
            root.render(<LandscapeWarning />);
        });
    };

    const warningEl = () => container.querySelector('#landscape-warning');

    it('shows a role="alert" warning with the localized message on mobile landscape', async () => {
        await renderWarning();

        const warning = warningEl();
        expect(warning).not.toBeNull();
        expect(warning.getAttribute('role')).toBe('alert');
        expect(container.querySelector('.landscape-warning-text').textContent).toBe(
            get('rotate_device_portrait', 'en')
        );
    });

    it('uses the learner language for the message', async () => {
        appStore.setState({ userData: { native_language: 'es' } });
        await renderWarning();

        expect(container.querySelector('.landscape-warning-text').textContent).toBe(
            get('rotate_device_portrait', 'es')
        );
        expect(container.querySelector('#landscape-warning-dismiss').getAttribute('aria-label')).toBe(
            get('dismiss', 'es')
        );
    });

    it('does not render on a mobile portrait viewport', async () => {
        setViewport(390, 844);
        await renderWarning();

        expect(warningEl()).toBeNull();
    });

    it('does not render on a desktop landscape viewport', async () => {
        setNavigator({ userAgent: DESKTOP_MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 });
        setViewport(1280, 720);
        await renderWarning();

        expect(warningEl()).toBeNull();
    });

    it('appears when the viewport rotates from portrait to landscape', async () => {
        setViewport(390, 844);
        await renderWarning();
        expect(warningEl()).toBeNull();

        setViewport(844, 390);
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(warningEl()).not.toBeNull();
    });

    it('also reacts to orientationchange', async () => {
        setViewport(390, 844);
        await renderWarning();
        expect(warningEl()).toBeNull();

        setViewport(844, 390);
        await act(async () => {
            window.dispatchEvent(new Event('orientationchange'));
        });

        expect(warningEl()).not.toBeNull();
    });

    it('hides the warning when the dismiss button is clicked', async () => {
        await renderWarning();
        expect(warningEl()).not.toBeNull();

        await act(async () => {
            container.querySelector('#landscape-warning-dismiss').click();
        });

        expect(warningEl()).toBeNull();
    });

    it('warns again after returning to portrait and back to landscape', async () => {
        await renderWarning();
        await act(async () => {
            container.querySelector('#landscape-warning-dismiss').click();
        });
        expect(warningEl()).toBeNull();

        setViewport(390, 844);
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(warningEl()).toBeNull();

        setViewport(844, 390);
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(warningEl()).not.toBeNull();
    });

    it('adds and removes both resize and orientationchange listeners', async () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        await renderWarning();

        const resizeHandler = addSpy.mock.calls.find((c) => c[0] === 'resize')?.[1];
        const orientationHandler = addSpy.mock.calls.find((c) => c[0] === 'orientationchange')?.[1];
        expect(typeof resizeHandler).toBe('function');
        expect(typeof orientationHandler).toBe('function');

        await act(async () => {
            root.unmount();
        });
        root = null;

        expect(removeSpy).toHaveBeenCalledWith('resize', resizeHandler);
        expect(removeSpy).toHaveBeenCalledWith('orientationchange', orientationHandler);
    });
});
