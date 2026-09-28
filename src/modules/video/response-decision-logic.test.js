import { describe, it, expect } from 'vitest';
import {
    isClosedResponseType,
    getResponseOverlayTextKey,
    getResponseAnswerLabelKey,
} from './response-decision-logic.js';

describe('response-decision-logic', () => {
    describe('isClosedResponseType', () => {
        it('treats closed and friend-closed responses as closed', () => {
            expect(isClosedResponseType('closedResponse')).toBe(true);
            expect(isClosedResponseType('friendClosedResponse')).toBe(true);
        });

        it('treats open and unknown responses as open', () => {
            expect(isClosedResponseType('openResponse')).toBe(false);
            expect(isClosedResponseType(undefined)).toBe(false);
            expect(isClosedResponseType('')).toBe(false);
        });
    });

    describe('getResponseOverlayTextKey', () => {
        it('returns the repeat-exactly copy for closed types', () => {
            expect(getResponseOverlayTextKey('closedResponse')).toBe('video_repeat_exactly');
            expect(getResponseOverlayTextKey('friendClosedResponse')).toBe('video_repeat_exactly');
        });

        it('returns the did-you-understand copy for open and unknown types', () => {
            expect(getResponseOverlayTextKey('openResponse')).toBe('video_did_understand');
            expect(getResponseOverlayTextKey(undefined)).toBe('video_did_understand');
            expect(getResponseOverlayTextKey(null)).toBe('video_did_understand');
            expect(getResponseOverlayTextKey('viewAndContinue')).toBe('video_did_understand');
            expect(getResponseOverlayTextKey('success')).toBe('video_did_understand');
            expect(getResponseOverlayTextKey('lessonIntro')).toBe('video_did_understand');
        });
    });

    describe('getResponseAnswerLabelKey', () => {
        it('returns repeat-now for closed types', () => {
            expect(getResponseAnswerLabelKey('closedResponse')).toBe('video_repeat_now');
            expect(getResponseAnswerLabelKey('friendClosedResponse')).toBe('video_repeat_now');
        });

        it('returns respond-now for open and unknown types', () => {
            expect(getResponseAnswerLabelKey('openResponse')).toBe('video_respond_now');
            expect(getResponseAnswerLabelKey(undefined)).toBe('video_respond_now');
        });
    });
});
