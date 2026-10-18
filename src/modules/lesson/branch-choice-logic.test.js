import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    BRANCH_RESPONSE_TYPE,
    BRANCH_OVERLAY_PHASE,
    BRANCH_OVERLAY_TEXT_KEY,
    BRANCH_DEEP_OVERLAY_TEXT_KEY,
    BRANCH_LABEL_CHAR_CAP,
    isBranchingStep,
    resolveBranchNodes,
    resolveBranchChoices,
    resolveNextStepIndex,
    formatBranchChoiceLabel,
    buildBranchChoiceView,
    resolveBranchLevel,
    getBranchHeadingKey,
} from './branch-choice-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('branch-choice-logic constants', () => {
    it('exposes the branching response type, phase and overlay text key', () => {
        expect(BRANCH_RESPONSE_TYPE).toBe('branching');
        expect(BRANCH_OVERLAY_PHASE).toBe('simpleVideo-decisionTime-branching');
        expect(BRANCH_OVERLAY_TEXT_KEY).toBe('video_choose_how_respond');
        expect(BRANCH_DEEP_OVERLAY_TEXT_KEY).toBe('video_choose_exactly');
        expect(BRANCH_LABEL_CHAR_CAP).toBe(48);
    });

    it('identifies branching steps only', () => {
        expect(isBranchingStep({ responseType: 'branching' })).toBe(true);
        expect(isBranchingStep({ responseType: 'closedResponse' })).toBe(false);
        expect(isBranchingStep(null)).toBe(false);
        expect(isBranchingStep(undefined)).toBe(false);
    });
});

describe('getBranchHeadingKey', () => {
    it('returns the first-row heading at depth 0 or when depth is absent', () => {
        expect(getBranchHeadingKey(0)).toBe(BRANCH_OVERLAY_TEXT_KEY);
        expect(getBranchHeadingKey()).toBe(BRANCH_OVERLAY_TEXT_KEY);
    });

    it('returns the nested-row heading at every deeper depth', () => {
        expect(getBranchHeadingKey(1)).toBe(BRANCH_DEEP_OVERLAY_TEXT_KEY);
        expect(getBranchHeadingKey(2)).toBe(BRANCH_DEEP_OVERLAY_TEXT_KEY);
    });
});

const nestedStep = {
    responseType: 'branching',
    chooseStep: [
        {
            text: { en: 'Yes', es: 'Sí' },
            chooseStep: [
                { nextStep: 1, text: { en: 'I love it' } },
                { nextStep: 2, text: { en: 'I like it a little' } },
            ],
        },
        {
            text: { en: 'No' },
            chooseStep: [
                { nextStep: 3, text: { en: "I don't like it" } },
            ],
        },
    ],
};

describe('resolveBranchNodes', () => {
    it('resolves group entries with children whose offsets are relative to the branching index', () => {
        const nodes = resolveBranchNodes(nestedStep, 2, 8);
        expect(nodes).toHaveLength(2);
        expect(nodes[0].text).toEqual({ en: 'Yes', es: 'Sí' });
        expect(nodes[0].targetIndex).toBeUndefined();
        expect(nodes[0].children).toHaveLength(2);
        expect(nodes[0].children[0].targetIndex).toBe(3);
        expect(nodes[0].children[1].targetIndex).toBe(4);
        expect(nodes[1].children[0].targetIndex).toBe(5);
    });

    it('drops a group whose every child is invalid', () => {
        const step = {
            chooseStep: [
                {
                    text: { en: 'Bad' },
                    chooseStep: [
                        { nextStep: 0, text: { en: 'zero' } },
                        { nextStep: 99, text: { en: 'past the end' } },
                        { nextStep: 1 },
                    ],
                },
                { text: { en: 'Good' }, chooseStep: [{ nextStep: 1, text: { en: 'z' } }] },
            ],
        };
        const nodes = resolveBranchNodes(step, 2, 8);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].text).toEqual({ en: 'Good' });
    });

    it('keeps a flat chooseStep of leaves (story-054 shape)', () => {
        const flat = {
            chooseStep: [
                { nextStep: 1, text: { en: 'A' } },
                { nextStep: 2, text: { en: 'B' } },
            ],
        };
        const nodes = resolveBranchNodes(flat, 2, 8);
        expect(nodes.map((n) => n.targetIndex)).toEqual([3, 4]);
        expect(nodes.every((n) => n.children === undefined)).toBe(true);
    });

    it('returns [] for absent, object or string chooseStep', () => {
        expect(resolveBranchNodes({}, 2, 8)).toEqual([]);
        expect(resolveBranchNodes({ chooseStep: undefined }, 2, 8)).toEqual([]);
        expect(resolveBranchNodes({ chooseStep: 'nope' }, 2, 8)).toEqual([]);
        expect(resolveBranchNodes(null, 2, 8)).toEqual([]);
    });
});

describe('resolveBranchChoices (nested)', () => {
    it('flattens every reachable leaf in depth-first array order', () => {
        const leaves = resolveBranchChoices(nestedStep, 2, 8);
        expect(leaves.map((l) => l.targetIndex)).toEqual([3, 4, 5]);
        expect(leaves.map((l) => l.text)).toEqual([
            { en: 'I love it' },
            { en: 'I like it a little' },
            { en: "I don't like it" },
        ]);
    });
});

describe('resolveBranchChoices', () => {
    const step = {
        responseType: 'branching',
        chooseStep: [
            { nextStep: 1, text: { en: 'A' } },
            { nextStep: 2, text: { en: 'B' } },
            { nextStep: 3, text: { en: 'C' } },
        ],
    };

    it('resolves offsets to absolute target indices in array order', () => {
        const resolved = resolveBranchChoices(step, 2, 6);
        expect(resolved.map((c) => c.targetIndex)).toEqual([3, 4, 5]);
        expect(resolved.map((c) => c.text)).toEqual([
            { en: 'A' }, { en: 'B' }, { en: 'C' },
        ]);
    });

    it('drops entries with invalid offsets', () => {
        const bad = {
            chooseStep: [
                { nextStep: 0, text: { en: 'zero' } },
                { nextStep: -1, text: { en: 'negative' } },
                { nextStep: 1.5, text: { en: 'fraction' } },
                { nextStep: 'x', text: { en: 'string' } },
                { nextStep: null, text: { en: 'null' } },
                { nextStep: undefined, text: { en: 'undefined' } },
                { text: { en: 'missing' } },
                { nextStep: 1, text: { en: 'valid' } },
            ],
        };
        const resolved = resolveBranchChoices(bad, 2, 6);
        expect(resolved).toHaveLength(1);
        expect(resolved[0].text).toEqual({ en: 'valid' });
        expect(resolved[0].targetIndex).toBe(3);
    });

    it('drops an entry whose target equals stepCount', () => {
        const resolved = resolveBranchChoices({ chooseStep: [{ nextStep: 4, text: { en: 'X' } }] }, 2, 6);
        expect(resolved).toEqual([]);
    });

    it('drops an entry with no text', () => {
        const resolved = resolveBranchChoices({ chooseStep: [{ nextStep: 1 }] }, 2, 6);
        expect(resolved).toEqual([]);
    });

    it('returns [] for an absent, empty-object or string chooseStep', () => {
        expect(resolveBranchChoices({}, 2, 6)).toEqual([]);
        expect(resolveBranchChoices({ chooseStep: undefined }, 2, 6)).toEqual([]);
        expect(resolveBranchChoices({ chooseStep: 'nope' }, 2, 6)).toEqual([]);
        expect(resolveBranchChoices(null, 2, 6)).toEqual([]);
    });
});

describe('resolveNextStepIndex', () => {
    it('honors an integer offset >= 1', () => {
        expect(resolveNextStepIndex({ nextStep: 3 }, 3)).toBe(6);
        expect(resolveNextStepIndex({ nextStep: 1 }, 0)).toBe(1);
    });

    it('defaults to +1 for absent or invalid offsets', () => {
        for (const nextStep of [undefined, 0, -1, 1.5, 'x', null]) {
            expect(resolveNextStepIndex({ nextStep }, 3)).toBe(4);
        }
        expect(resolveNextStepIndex({}, 3)).toBe(4);
    });

    it('does not clamp a target beyond the lesson', () => {
        expect(resolveNextStepIndex({ nextStep: 5 }, 6)).toBe(11);
    });
});

describe('formatBranchChoiceLabel', () => {
    it('shows both lines when a localized value exists and the step keeps English', () => {
        expect(formatBranchChoiceLabel({ en: 'Yes', es: 'Sí' }, 'es', true)).toEqual({
            english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: true,
        });
    });

    it('honors the step-level decision (English only when no room for both)', () => {
        expect(formatBranchChoiceLabel({ en: 'Yes', es: 'Sí' }, 'es', false)).toEqual({
            english: 'Yes', localized: null, lang: 'es', showEnglish: true,
        });
    });

    it('falls back to English only when the translation is absent', () => {
        expect(formatBranchChoiceLabel({ en: 'Yes' }, 'es', true)).toEqual({
            english: 'Yes', localized: null, lang: 'es', showEnglish: true,
        });
        // No translation to fall back to, so English stays even when the step
        // decided to drop it everywhere else.
        expect(formatBranchChoiceLabel({ en: 'Yes' }, 'es', false)).toEqual({
            english: 'Yes', localized: null, lang: 'es', showEnglish: true,
        });
    });

    it('falls back to English only for the English language', () => {
        expect(formatBranchChoiceLabel({ en: 'Yes', es: 'Sí' }, 'en', true)).toEqual({
            english: 'Yes', localized: null, lang: 'en', showEnglish: true,
        });
    });
});

describe('buildBranchChoiceView', () => {
    const step = {
        responseType: 'branching',
        chooseStep: [
            { nextStep: 1, text: { en: 'Yes', es: 'Sí' } },
            { nextStep: 2, text: { en: 'No' } },
        ],
    };

    it('maps resolved choices to keys, targets and labels', () => {
        const view = buildBranchChoiceView({ step, currentStepIndex: 2, stepCount: 6, lang: 'es' });
        expect(view.showContinue).toBe(false);
        expect(view.choices).toHaveLength(2);
        expect(view.choices[0]).toEqual({
            key: 0,
            targetIndex: 3,
            label: { english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: true },
        });
        expect(view.choices[1]).toEqual({
            key: 1,
            targetIndex: 4,
            label: { english: 'No', localized: null, lang: 'es', showEnglish: true },
        });
    });

    // The cap is decided once per step, not per label: the whole column either
    // shows both languages or English-only. A per-label decision is the bug
    // this guards (one button bilingual, its neighbour translation-only).
    const atCapText = () => ({
        en: 'a'.repeat(24),
        es: 'b'.repeat(BRANCH_LABEL_CHAR_CAP - 24),
    });
    const overCapText = () => ({
        en: 'a'.repeat(24),
        es: 'b'.repeat(BRANCH_LABEL_CHAR_CAP - 24 + 1),
    });

    it('shows both lines on every button when all labels fit the cap', () => {
        const capStep = {
            responseType: 'branching',
            chooseStep: [
                { nextStep: 1, text: atCapText() },
                { nextStep: 2, text: atCapText() },
            ],
        };
        const view = buildBranchChoiceView({ step: capStep, currentStepIndex: 0, stepCount: 4, lang: 'es' });
        expect(view.choices.map((c) => c.label.showEnglish)).toEqual([true, true]);
    });

    it('drops the localized line from every button when any label is over the cap', () => {
        const mixedStep = {
            responseType: 'branching',
            chooseStep: [
                { nextStep: 1, text: { en: 'Yes', es: 'Sí' } },
                { nextStep: 2, text: overCapText() },
            ],
        };
        const view = buildBranchChoiceView({ step: mixedStep, currentStepIndex: 0, stepCount: 4, lang: 'es' });
        // The short label fits on its own, but the long sibling forces the whole
        // step to English-only so the buttons stay consistent.
        expect(view.choices.map((c) => c.label.showEnglish)).toEqual([true, true]);
        expect(view.choices[0].label.localized).toBeNull();
        expect(view.choices[1].label.localized).toBeNull();
    });

    it('keeps English-only on a button that has no translation even when a sibling is over the cap', () => {
        const noTranslationStep = {
            responseType: 'branching',
            chooseStep: [
                { nextStep: 1, text: { en: 'No' } },
                { nextStep: 2, text: overCapText() },
            ],
        };
        const view = buildBranchChoiceView({ step: noTranslationStep, currentStepIndex: 0, stepCount: 4, lang: 'es' });
        expect(view.choices[0].label).toEqual({
            english: 'No', localized: null, lang: 'es', showEnglish: true,
        });
        expect(view.choices[1].label.showEnglish).toBe(true);
        expect(view.choices[1].label.localized).toBeNull();
    });

    it('sets showContinue when no valid choices resolve', () => {
        expect(buildBranchChoiceView({ step: {}, currentStepIndex: 2, stepCount: 6, lang: 'es' })).toEqual({
            choices: [], showContinue: true,
        });
        expect(buildBranchChoiceView({
            step: { chooseStep: [{ nextStep: 0, text: { en: 'x' } }] },
            currentStepIndex: 2, stepCount: 6, lang: 'es',
        })).toEqual({ choices: [], showContinue: true });
    });
});

describe('buildBranchChoiceView (nested)', () => {
    it('maps nested nodes to keyed group and leaf choices', () => {
        const view = buildBranchChoiceView({ step: nestedStep, currentStepIndex: 2, stepCount: 8, lang: 'es' });
        expect(view.showContinue).toBe(false);
        expect(view.choices).toHaveLength(2);

        const group = view.choices[0];
        expect(group.key).toBe(0);
        expect(group.targetIndex).toBeUndefined();
        expect(group.label).toEqual({ english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: true });
        expect(group.children).toHaveLength(2);
        expect(group.children[0]).toEqual({
            key: 0,
            label: { english: 'I love it', localized: null, lang: 'es', showEnglish: true },
            targetIndex: 3,
        });
        expect(group.children[1].key).toBe(1);
        expect(group.children[1].targetIndex).toBe(4);

        const secondGroup = view.choices[1];
        expect(secondGroup.children[0].targetIndex).toBe(5);
    });

    // The cap is decided once per LEVEL, not once per step: a long label inside
    // a group must not strip English from the group's own (short) row.
    it('decides the English cap per level', () => {
        const overCapText = () => ({
            en: 'a'.repeat(24),
            es: 'b'.repeat(BRANCH_LABEL_CHAR_CAP - 24 + 1),
        });
        const step = {
            responseType: 'branching',
            chooseStep: [
                {
                    text: { en: 'Yes', es: 'Sí' },
                    chooseStep: [
                        { nextStep: 1, text: overCapText() },
                        { nextStep: 2, text: { en: 'Short', es: 'Corto' } },
                    ],
                },
            ],
        };
        const view = buildBranchChoiceView({ step, currentStepIndex: 0, stepCount: 4, lang: 'es' });
        // Root row: the group label is short, so it keeps both lines.
        expect(view.choices[0].label.showEnglish).toBe(true);
        // Nested row: the over-cap sibling forces English-only for the level.
        expect(view.choices[0].children.map((c) => c.label.showEnglish)).toEqual([true, true]);
        expect(view.choices[0].children[0].label.localized).toBeNull();
    });

    it('sets showContinue when no valid node resolves', () => {
        expect(buildBranchChoiceView({
            step: { chooseStep: [{ text: { en: 'x' }, chooseStep: [] }] },
            currentStepIndex: 2, stepCount: 6, lang: 'es',
        })).toEqual({ choices: [], showContinue: true });
    });
});

describe('resolveBranchLevel', () => {
    const view = buildBranchChoiceView({ step: nestedStep, currentStepIndex: 2, stepCount: 8, lang: 'en' });

    it('returns the root level with canGoBack false when no path is given', () => {
        const level = resolveBranchLevel(view);
        expect(level.choices).toBe(view.choices);
        expect(level.canGoBack).toBe(false);
        expect(level.showContinue).toBe(false);
    });

    it('descends one level and reports canGoBack true', () => {
        const level = resolveBranchLevel(view, [0]);
        expect(level.choices).toBe(view.choices[0].children);
        expect(level.canGoBack).toBe(true);
        expect(level.showContinue).toBe(false);
    });

    it('walks two levels', () => {
        const deeperStep = {
            responseType: 'branching',
            chooseStep: [
                { text: { en: 'L1' }, chooseStep: [
                    { text: { en: 'L2' }, chooseStep: [
                        { nextStep: 1, text: { en: 'Leaf' } },
                    ] },
                ] },
            ],
        };
        const deepView = buildBranchChoiceView({ step: deeperStep, currentStepIndex: 0, stepCount: 3, lang: 'en' });
        const level = resolveBranchLevel(deepView, [0, 0]);
        expect(level.canGoBack).toBe(true);
        expect(level.choices[0].targetIndex).toBe(1);
    });

    it('falls back to the root for an out-of-range or non-array path', () => {
        expect(resolveBranchLevel(view, [9]).choices).toBe(view.choices);
        expect(resolveBranchLevel(view, [9]).canGoBack).toBe(false);
        expect(resolveBranchLevel(view, 'nope').choices).toBe(view.choices);
        expect(resolveBranchLevel(view, 'nope').canGoBack).toBe(false);
    });

    it('falls back to the root when a path key names a leaf', () => {
        // view.choices[0].children[0] is a leaf (no children), so [0, 0] cannot
        // descend twice.
        const level = resolveBranchLevel(view, [0, 0]);
        expect(level.choices).toBe(view.choices);
        expect(level.canGoBack).toBe(false);
    });

    it('mirrors showContinue at the root of an empty view', () => {
        expect(resolveBranchLevel({ choices: [], showContinue: true })).toEqual({
            choices: [], canGoBack: false, showContinue: true,
        });
    });
});

describe('branch-choice-logic purity', () => {
    const source = read('src/modules/lesson/branch-choice-logic.js');

    it('stays free of React, the store, and DOM globals', () => {
        expect(source).not.toContain("from 'react'");
        expect(source).not.toContain('appStore');
        expect(source).not.toContain('document.');
        expect(source).not.toContain('window.');
    });
});
