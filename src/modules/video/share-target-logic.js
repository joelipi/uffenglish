// share-target-logic.js
// Pure decision for how the success-screen Share button delivers the
// concatenated recap: the OS share sheet on mobile, a direct file download
// everywhere else. No React, no DOM, no React Native imports.
//
// Evidence (stories/060-autoplay-share-video, desktop-download follow-up):
// the Web Share spec rejects with an identical AbortError both when the user
// cancels AND when no share targets are available, and desktop OS
// implementations are unreliable (Windows: AbortError with no sheet ever
// appearing; Edge desktop and Firefox desktop lack file sharing). Mobile
// (iOS incl. iPadOS, Android) sheets are reliable, so only mobile keeps the
// native path.
import { isMobileUserAgent } from '../utils/orientation.js';

export const SHARE_TARGET_NATIVE = 'native';
export const SHARE_TARGET_DOWNLOAD = 'download';

/**
 * Delivery target from explicit navigator parts (injected, so unit tests
 * can drive every OS without a browser).
 */
export function resolveShareTarget({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    return isMobileUserAgent({ userAgent, platform, maxTouchPoints })
        ? SHARE_TARGET_NATIVE
        : SHARE_TARGET_DOWNLOAD;
}

/**
 * Delivery target for the current runtime. Unknown runtimes (no navigator,
 * e.g. the unshipped native shell) keep today's native behavior. Pass an
 * explicit null in tests to pin the no-runtime branch deterministically
 * (jsdom ships its own navigator, so a bare call is env-dependent there).
 */
export function getDeviceShareTarget(nav = undefined) {
    const runtime = nav === undefined
        ? (typeof navigator !== 'undefined' ? navigator : null)
        : nav;
    if (!runtime) return SHARE_TARGET_NATIVE;
    return resolveShareTarget({
        userAgent: runtime.userAgent,
        platform: runtime.platform,
        maxTouchPoints: runtime.maxTouchPoints,
    });
}
