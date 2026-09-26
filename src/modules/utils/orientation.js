// orientation.js — pure orientation/mobile predicates shared by the landscape
// recording warning. No React, no DOM APIs, so it is trivially unit-testable.

/**
 * A viewport is landscape when it is wider than it is tall.
 * Unknown/non-finite dimensions are treated as not-landscape.
 */
export function isLandscape(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > height;
}

/**
 * Mobile = iOS (iPad/iPhone/iPod UA, or iPadOS reporting "MacIntel" with
 * touch points) or Android. Desktop Mac/Windows/Linux is never mobile, even
 * with a touchscreen.
 */
export function isMobileUserAgent({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    const ua = String(userAgent || '');
    const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
    const android = /Android/.test(ua);
    return ios || android;
}

/**
 * The warning is only shown on a mobile device held in landscape.
 */
export function shouldWarnLandscape({ isMobile, landscape } = {}) {
    return !!isMobile && !!landscape;
}
