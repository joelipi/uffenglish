import { describe, it, expect } from 'vitest';
import {
    REDIRECT_SECONDS,
    initialCountdown,
    nextCountdown,
    shouldRedirect,
} from './confirm-email-redirect-logic.js';

describe('confirm-email redirect logic', () => {
    it('starts at the configured number of seconds', () => {
        expect(initialCountdown()).toBe(REDIRECT_SECONDS);
        expect(REDIRECT_SECONDS).toBe(3);
    });

    it('decrements by one each tick', () => {
        expect(nextCountdown(3)).toBe(2);
        expect(nextCountdown(2)).toBe(1);
        expect(nextCountdown(1)).toBe(0);
    });

    it('fires the redirect only when the countdown reaches zero or below', () => {
        expect(shouldRedirect(3)).toBe(false);
        expect(shouldRedirect(1)).toBe(false);
        expect(shouldRedirect(0)).toBe(true);
        expect(shouldRedirect(-1)).toBe(true);
    });
});
