// share-target-logic.test.js
// Unit tests for the share-target decision
// (stories/060-autoplay-share-video, desktop-download follow-up). Every OS
// is driven with injected navigator parts — no browser needed.
import { describe, it, expect } from 'vitest';
import {
    SHARE_TARGET_NATIVE,
    SHARE_TARGET_DOWNLOAD,
    resolveShareTarget,
    getDeviceShareTarget,
} from './share-target-logic.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CROS = 'Mozilla/5.0 (X11; CrOS x86_64 15699.58.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('resolveShareTarget', () => {
    it.each([
        ['iPhone', IPHONE, 'iPhone', 2],
        ['iPad', IPAD, 'iPad', 2],
        ['Android', ANDROID, 'Linux armv8l', 5],
    ])('%s uses the native sheet', (_name, userAgent, platform, maxTouchPoints) => {
        expect(resolveShareTarget({ userAgent, platform, maxTouchPoints })).toBe(SHARE_TARGET_NATIVE);
    });

    it('treats iPadOS reporting MacIntel with touch as mobile (native sheet)', () => {
        expect(resolveShareTarget({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            platform: 'MacIntel',
            maxTouchPoints: 5,
        })).toBe(SHARE_TARGET_NATIVE);
    });

    it.each([
        ['Windows Chrome', WINDOWS, 'Win32', 0],
        ['macOS Chrome', MAC, 'MacIntel', 0],
        ['Chromebook', CROS, 'Linux x86_64', 0],
        ['Linux Firefox', LINUX, 'Linux x86_64', 0],
        ['touchscreen Windows laptop', WINDOWS, 'Win32', 10],
    ])('%s downloads instead', (_name, userAgent, platform, maxTouchPoints) => {
        expect(resolveShareTarget({ userAgent, platform, maxTouchPoints })).toBe(SHARE_TARGET_DOWNLOAD);
    });

    it('defaults unknown/empty runtimes to download via resolve, native via device', () => {
        expect(resolveShareTarget({})).toBe(SHARE_TARGET_DOWNLOAD);
        expect(getDeviceShareTarget(null)).toBe(SHARE_TARGET_NATIVE);
    });
});

describe('getDeviceShareTarget', () => {
    it('reads an injected navigator-like object', () => {
        expect(getDeviceShareTarget({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }))
            .toBe(SHARE_TARGET_NATIVE);
        expect(getDeviceShareTarget({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 0 }))
            .toBe(SHARE_TARGET_DOWNLOAD);
    });
});
