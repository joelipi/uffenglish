// src/modules/video/response-decision-logic.js
// Pure classification for the simple-video response decision overlay.
// No React, no DOM — mirrored after the interactive classification in
// useInteractiveVideo.js / DecisionButtons.jsx so both response paths agree
// on which response types are "closed" (repeat exactly) vs open.

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
