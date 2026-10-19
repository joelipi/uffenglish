// src/modules/lesson/branch-choice-logic.js
// Pure rules for the `branching` step type. No React, no DOM, no store — the
// offset math, choice/target validation, next-step resolution, label selection
// and render-ready view-model all live here so the presentational component and
// the container stay free of domain decisions.
//
// A branching step plays a clip, then offers a set of labelled buttons; each
// button either jumps to a chosen step (a leaf) or reveals a further set of
// buttons (a group, expressed as a nested `chooseStep` array). Both the
// per-choice `nextStep` and the step-level `nextStep` are forward-only 1-based
// offsets from the step's own index.

import { formatBilingualText } from '../bilingual/bilingual-display.js';

export const BRANCH_RESPONSE_TYPE = 'branching';
export const BRANCH_OVERLAY_PHASE = 'simpleVideo-decisionTime-branching';
// Headline for the first row of buttons (depth 0) ...
export const BRANCH_OVERLAY_TEXT_KEY = 'video_choose_how_respond';
// ... and for every deeper row, once a group has been chosen.
export const BRANCH_DEEP_OVERLAY_TEXT_KEY = 'video_choose_exactly';

export function isBranchingStep(step) {
    return step?.responseType === BRANCH_RESPONSE_TYPE;
}

// A valid offset is a whole number >= 1 (forward-only).
function hasValidOffset(offset) {
    return Number.isInteger(offset) && offset >= 1;
}

/**
 * Resolves one `chooseStep` entry to a node. An entry whose `chooseStep` is an
 * array is a GROUP: its children are resolved recursively and the node is kept
 * only when at least one child resolves. Every other entry is a LEAF and is
 * kept only when it carries `text` and an integer `nextStep >= 1` whose target
 * falls inside `[0, stepCount)`. Invalid entries resolve to `null`.
 *
 * @returns {{ text: object, children?: Array } | { text: object, targetIndex: number } | null}
 */
function resolveNode(entry, currentStepIndex, stepCount) {
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.text) return null;

    if (Array.isArray(entry.chooseStep)) {
        const children = [];
        for (const child of entry.chooseStep) {
            const resolved = resolveNode(child, currentStepIndex, stepCount);
            if (resolved) children.push(resolved);
        }
        if (children.length === 0) return null;
        return { text: entry.text, children };
    }

    if (!hasValidOffset(entry.nextStep)) return null;
    const targetIndex = currentStepIndex + entry.nextStep;
    if (targetIndex < 0 || targetIndex >= stepCount) return null;

    return { text: entry.text, targetIndex };
}

/**
 * Resolves a branching step's `chooseStep` into its top-level nodes, in array
 * order, dropping invalid entries (recursively). A missing / non-array
 * `chooseStep` yields `[]`. Group nodes carry `children`; leaf nodes carry
 * `targetIndex`.
 *
 * @returns {Array<object>}
 */
export function resolveBranchNodes(step, currentStepIndex, stepCount) {
    const entries = step?.chooseStep;
    if (!Array.isArray(entries)) return [];

    const nodes = [];
    for (const entry of entries) {
        const resolved = resolveNode(entry, currentStepIndex, stepCount);
        if (resolved) nodes.push(resolved);
    }
    return nodes;
}

/**
 * Every LEAF reachable through a branching step's `chooseStep`, depth-first in
 * array order, as `{ text, targetIndex }`. Flat steps behave exactly as before;
 * the recursion means nested groups' targets are still visible here, which is
 * what `video-processor-logic.js` `branchParentIndexForResponse` relies on.
 *
 * @returns {Array<{ text: object, targetIndex: number }>}
 */
export function resolveBranchChoices(step, currentStepIndex, stepCount) {
    const leaves = [];
    const walk = (nodes) => {
        for (const node of nodes) {
            if (node.children) walk(node.children);
            else leaves.push({ text: node.text, targetIndex: node.targetIndex });
        }
    };
    walk(resolveBranchNodes(step, currentStepIndex, stepCount));
    return leaves;
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
 * - localized value exists and there is room for both -> stacked (both lines).
 * - localized value exists but there is no room for both -> English only.
 *
 * The both-languages decision is made **once for the whole level** and
 * passed in as `showBoth`, so every button visible at that level agrees and
 * this function never re-decides per label.
 *
 * @param {object} text
 * @param {string} lang
 * @param {boolean} showBoth level-level decision from `buildBranchChoiceView`
 * @returns {{ english: string, localized: string|null, lang: string, showEnglish: boolean }}
 */
export function formatBranchChoiceLabel(text, lang, showBoth) {
    const { english, localized, shouldShowLocalized } = formatBilingualText(text, lang);

    // English is the default: it is always rendered. The localized line is
    // added only when there is room for both (showBoth); otherwise the button
    // shows English only, never the localized language on its own.
    if (!shouldShowLocalized) {
        return { english, localized: null, lang, showEnglish: true };
    }

    if (showBoth) {
        return { english, localized, lang, showEnglish: true };
    }

    return { english, localized: null, lang, showEnglish: true };
}

// Maps resolved nodes to render-ready choices, recursively. The English
// decision is made once per level and applied to every label at that level.
function buildLevel(nodes, lang) {
    // Localized translations are always included (see commit
    // "Always include localized translations on branching buttons").
    const showBoth = true;
    return nodes.map((node, index) => {
        const label = formatBranchChoiceLabel(node.text, lang, showBoth);
        if (node.children) return { key: index, label, children: buildLevel(node.children, lang) };
        return { key: index, label, targetIndex: node.targetIndex };
    });
}

/**
 * The only function the container calls to prepare rendering. Returns the
 * resolved top level mapped to `{ key, label, targetIndex }` (leaf) or
 * `{ key, label, children }` (group), recursively, plus `showContinue`, which is
 * true when there are no valid top-level choices (a mis-authored branching step
 * must not strand the learner).
 */
export function buildBranchChoiceView({ step, currentStepIndex, stepCount, lang } = {}) {
    const choices = buildLevel(resolveBranchNodes(step, currentStepIndex, stepCount), lang);

    return { choices, showContinue: choices.length === 0 };
}

/**
 * The visible level of a pre-built view for a chosen `path` (an array of
 * sibling `key`s, one per group entered). Returns `{ choices, canGoBack,
 * showContinue }`. An absent / non-array `path`, an out-of-range key, or a key
 * naming a leaf falls back to the root level and `canGoBack` false — it never
 * throws, so a stale path cannot break rendering.
 */
export function resolveBranchLevel(view, path = []) {
    const root = view?.choices || [];
    const keys = Array.isArray(path) ? path : [];

    let choices = root;
    let descended = false;
    for (const key of keys) {
        const next = choices.find((choice) => choice.key === key && Array.isArray(choice.children));
        if (!next) {
            choices = root;
            descended = false;
            break;
        }
        choices = next.children;
        descended = true;
    }

    return {
        choices,
        canGoBack: descended,
        showContinue: !descended && root.length === 0,
    };
}

/**
 * The overlay headline key for the current branching choice depth. The first
 * row (depth 0) asks how the learner will respond; every deeper row asks them
 * to pick the exact wording.
 */
export function getBranchHeadingKey(depth = 0) {
    return Number(depth) > 0 ? BRANCH_DEEP_OVERLAY_TEXT_KEY : BRANCH_OVERLAY_TEXT_KEY;
}
