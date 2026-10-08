import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    BRANCH_RESPONSE_TYPE,
    BRANCH_OVERLAY_PHASE,
    BRANCH_OVERLAY_TEXT_KEY,
    BRANCH_LABEL_CHAR_CAP,
    isBranchingStep,
    resolveBranchChoices,
    resolveNextStepIndex,
    formatBranchChoiceLabel,
    buildBranchChoiceView,
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
        expect(BRANCH_LABEL_CHAR_CAP).toBe(48);
    });

    it('identifies branching steps only', () => {
        expect(isBranchingStep({ responseType: 'branching' })).toBe(true);
        expect(isBranchingStep({ responseType: 'closedResponse' })).toBe(false);
        expect(isBranchingStep(null)).toBe(false);
        expect(isBranchingStep(undefined)).toBe(false);
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

    it('honors the step-level showEnglish decision (translation only)', () => {
        expect(formatBranchChoiceLabel({ en: 'Yes', es: 'Sí' }, 'es', false)).toEqual({
            english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: false,
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
    // shows both languages or translation-only. A per-label decision is the bug
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

    it('drops English from every button when any label is over the cap', () => {
        const mixedStep = {
            responseType: 'branching',
            chooseStep: [
                { nextStep: 1, text: { en: 'Yes', es: 'Sí' } },
                { nextStep: 2, text: overCapText() },
            ],
        };
        const view = buildBranchChoiceView({ step: mixedStep, currentStepIndex: 0, stepCount: 4, lang: 'es' });
        // The short label fits on its own, but the long sibling forces the whole
        // step to translation-only so the buttons stay consistent.
        expect(view.choices.map((c) => c.label.showEnglish)).toEqual([false, false]);
        expect(view.choices[0].label.localized).toBe('Sí');
        expect(view.choices[1].label.localized).toBe(overCapText().es);
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
        expect(view.choices[1].label.showEnglish).toBe(false);
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

describe('branch-choice-logic purity', () => {
    const source = read('src/modules/lesson/branch-choice-logic.js');

    it('stays free of React, the store, and DOM globals', () => {
        expect(source).not.toContain("from 'react'");
        expect(source).not.toContain('appStore');
        expect(source).not.toContain('document.');
        expect(source).not.toContain('window.');
    });
});
