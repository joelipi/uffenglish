// src/modules/lesson/branch-choice-logic.js
// Pure rules for the `branching` step type. No React, no DOM, no store — the
// offset math, choice/target validation, next-step resolution, label selection
// and render-ready view-model all live here so the presentational component and
// the container stay free of domain decisions.
//
// A branching step plays a clip, then offers a set of labelled buttons; each
// button jumps to a chosen step. Both the per-choice `nextStep` and the
// step-level `nextStep` are forward-only 1-based offsets from the step's own
// index.

import { formatBilingualText } from '../bilingual/bilingual-display.js';

export const BRANCH_RESPONSE_TYPE = 'branching';
export const BRANCH_OVERLAY_PHASE = 'simpleVideo-decisionTime-branching';
export const BRANCH_OVERLAY_TEXT_KEY = 'video_choose_how_respond';

// Combined English + translation length above which the label drops the English
// line and shows the translation only. The single "space does not allow" knob.
export const BRANCH_LABEL_CHAR_CAP = 48;

export function isBranchingStep(step) {
    return step?.responseType === BRANCH_RESPONSE_TYPE;
}

// A valid offset is a whole number >= 1 (forward-only).
function hasValidOffset(offset) {
    return Number.isInteger(offset) && offset >= 1;
}

/**
 * Resolves a branching step's `chooseStep` into concrete choices in array
 * order. Entries are dropped when the offset is not an integer >= 1, when the
 * resolved target falls outside `[0, stepCount)`, or when the entry has no
 * `text`. A missing / non-array `chooseStep` yields `[]`.
 *
 * @returns {Array<{ text: object, targetIndex: number }>}
 */
export function resolveBranchChoices(step, currentStepIndex, stepCount) {
    const entries = step?.chooseStep;
    if (!Array.isArray(entries)) return [];

    const resolved = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.text) continue;
        if (!hasValidOffset(entry.nextStep)) continue;

        const targetIndex = currentStepIndex + entry.nextStep;
        if (targetIndex < 0 || targetIndex >= stepCount) continue;

        resolved.push({ text: entry.text, targetIndex });
    }
    return resolved;
}

/**
 * The index to advance to after `step` completes. Uses `step.nextStep` when it
 * is an integer >= 1, otherwise defaults to `+1`. Does NOT clamp to the lesson
 * length — callers treat an index >= length as end-of-lesson.
 */
export function resolveNextStepIndex(step, currentStepIndex) {
    const offset = hasValidOffset(step?.nextStep) ? step.nextStep : 1;
    return currentStepIndex + offset;
}

/**
 * Chooses how a branch choice's text renders:
 * - no localized value for `lang` -> English only (`showEnglish: true`).
 * - localized value exists and combined length <= cap -> stacked (both lines).
 * - localized value exists and combined length > cap -> translation only.
 *
 * @returns {{ english: string, localized: string|null, lang: string, showEnglish: boolean }}
 */
export function formatBranchChoiceLabel(text, lang) {
    const { english, localized, shouldShowLocalized } = formatBilingualText(text, lang);

    if (!shouldShowLocalized) {
        return { english, localized: null, lang, showEnglish: true };
    }

    const showEnglish = english.length + localized.length <= BRANCH_LABEL_CHAR_CAP;
    return { english, localized, lang, showEnglish };
}

/**
 * The only function the container calls to prepare rendering. Returns the
 * resolved choices mapped to `{ key, targetIndex, label }` plus `showContinue`,
 * which is true when there are no valid choices (a mis-authored branching step
 * must not strand the learner).
 */
export function buildBranchChoiceView({ step, currentStepIndex, stepCount, lang } = {}) {
    const choices = resolveBranchChoices(step, currentStepIndex, stepCount).map((choice, index) => ({
        key: index,
        targetIndex: choice.targetIndex,
        label: formatBranchChoiceLabel(choice.text, lang),
    }));

    return { choices, showContinue: choices.length === 0 };
}
