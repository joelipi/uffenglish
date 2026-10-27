// The transcript review's countdown is OFF by default: the learner accepts or
// re-records whenever they are ready (no timer, no auto-accept).
import { describe, it, expect } from 'vitest';
import {
    REVIEW_COUNTDOWN_ENABLED,
    REVIEW_COUNTDOWN_SECONDS,
    isReviewCountdownEnabled,
    resolveReviewCountdownStart,
    reviewCountdownProgress,
    shouldAutoAcceptReview,
    shouldShowReviewCountdown,
} from './review-countdown-logic.js';

describe('the review countdown is off by default', () => {
    it('the shipped switch is off', () => {
        expect(REVIEW_COUNTDOWN_ENABLED).toBe(false);
        expect(isReviewCountdownEnabled()).toBe(false);
    });

    it('a review with no countdown starts from null, not from a number', () => {
        expect(resolveReviewCountdownStart()).toBeNull();
        expect(resolveReviewCountdownStart({ enabled: false })).toBeNull();
    });

    it('never accepts on the learner\'s behalf while it is off', () => {
        expect(shouldAutoAcceptReview({ timeLeft: 0 })).toBe(false);
        expect(shouldAutoAcceptReview({ timeLeft: -1 })).toBe(false);
        expect(shouldAutoAcceptReview({ timeLeft: null })).toBe(false);
        // Off wins even if a stale countdown value reaches the rule.
        expect(shouldAutoAcceptReview({ timeLeft: 0, enabled: false })).toBe(false);
    });

    it('shows no timer and no bar when the store has no time left', () => {
        expect(shouldShowReviewCountdown(null)).toBe(false);
        expect(shouldShowReviewCountdown(undefined)).toBe(false);
        expect(reviewCountdownProgress(null)).toBe(0);
        expect(reviewCountdownProgress(undefined)).toBe(0);
    });
});

describe('turning it back on is the one switch', () => {
    it('starts at the documented number of seconds', () => {
        expect(resolveReviewCountdownStart({ enabled: true })).toBe(REVIEW_COUNTDOWN_SECONDS);
        expect(REVIEW_COUNTDOWN_SECONDS).toBe(7);
    });

    it('auto-accepts only when the enabled countdown reaches zero', () => {
        expect(shouldAutoAcceptReview({ timeLeft: 1, enabled: true })).toBe(false);
        expect(shouldAutoAcceptReview({ timeLeft: 0, enabled: true })).toBe(true);
        expect(shouldAutoAcceptReview({ timeLeft: -2, enabled: true })).toBe(true);
        expect(shouldAutoAcceptReview({ timeLeft: null, enabled: true })).toBe(false);
    });

    it('renders the timer and fills the bar from the remaining time', () => {
        expect(shouldShowReviewCountdown(7)).toBe(true);
        expect(shouldShowReviewCountdown(0)).toBe(true);
        expect(reviewCountdownProgress(REVIEW_COUNTDOWN_SECONDS)).toBe(100);
        expect(reviewCountdownProgress(0)).toBe(0);
        expect(reviewCountdownProgress(3.5)).toBe(50);
        // Out-of-range readings must not overflow the bar.
        expect(reviewCountdownProgress(99)).toBe(100);
        expect(reviewCountdownProgress(-4)).toBe(0);
        expect(reviewCountdownProgress(3, 0)).toBe(0);
    });
});
