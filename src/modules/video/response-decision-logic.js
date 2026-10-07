// src/modules/video/response-decision-logic.js
// Pure classification for the simple-video response decision overlay.
// No React, no DOM — mirrored after the interactive classification in
// useInteractiveVideo.js / DecisionButtons.jsx so both response paths agree
// on which response types are "closed" (repeat exactly) vs open.

import { BRANCH_OVERLAY_PHASE, BRANCH_OVERLAY_TEXT_KEY } from '../lesson/branch-choice-logic.js';

const CLOSED_RESPONSE_TYPES = ['closedResponse', 'friendClosedResponse'];

export function isClosedResponseType(responseType) {
    return CLOSED_RESPONSE_TYPES.includes(responseType);
}

export function getResponseOverlayTextKey(responseType) {
    return isClosedResponseType(responseType) ? 'video_repeat_exactly' : 'video_did_understand';
}

export function getResponseAnswerLabelKey(responseType) {
    return isClosedResponseType(responseType) ? 'video_repeat_now' : 'video_respond_now';
}

/**
 * The overlay heading shown over a simple-video decision screen. Owns every
 * phase-to-copy decision so the player component holds no inline ternary.
 */
export function getSimpleVideoOverlayTextKey(appPhase, currentVideo) {
    if (appPhase === BRANCH_OVERLAY_PHASE) return BRANCH_OVERLAY_TEXT_KEY;
    if (appPhase === 'simpleVideo-decisionTime-response') return getResponseOverlayTextKey(currentVideo?.responseType);
    if (appPhase === 'lessonSuccess-decisionTime') return 'video_continue_create';
    return 'video_continue';
}
