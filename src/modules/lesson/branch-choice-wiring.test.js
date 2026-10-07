// src/modules/lesson/branch-choice-wiring.test.js
// Source guards for story 054's wiring. Each guard slices the specific
// function/block it protects (never the whole file, never to EOF) and asserts
// every property, so removing the wiring makes the guard fail rather than pass
// vacuously.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeConfig } from '../bilingual/config-normalizer.js';
import { getBilingual } from '../../data/strings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

// A function body from `const <name>` to the next top-level (4-space-indented)
// `const` declaration. Name-agnostic so an inserted helper cannot silently
// extend the slice (AGENTS: never slice a function body to EOF).
function functionSlice(src, name) {
    const start = src.indexOf(`const ${name}`);
    expect(start, `missing ${name}`).toBeGreaterThan(-1);
    const end = src.indexOf('\n    const ', start + 1);
    return src.slice(start, end === -1 ? undefined : end);
}

// A CSS rule block from its selector to the matching closing brace.
function cssBlock(src, selector) {
    const start = src.indexOf(selector);
    expect(start, `missing ${selector}`).toBeGreaterThan(-1);
    const end = src.indexOf('}', start);
    return src.slice(start, end + 1);
}

describe('SimpleVideoPlayer branch wiring', () => {
    const source = read('src/components/SimpleVideoPlayer.web.jsx');

    it('imports the branch predicate/phase and the pure overlay-text resolver', () => {
        expect(source).toContain("import { isBranchingStep, BRANCH_OVERLAY_PHASE } from '../modules/lesson/branch-choice-logic.js';");
        expect(source).toContain("import { getSimpleVideoOverlayTextKey } from '../modules/video/response-decision-logic.js';");
    });

    it('derives overlayTextKey from the pure resolver', () => {
        expect(source).toContain('getSimpleVideoOverlayTextKey(appPhase, currentVideo)');
    });

    it('raises the branch overlay from handleEnded before the viewAndContinue check', () => {
        const body = functionSlice(source, 'handleEnded');
        expect(body).toContain('isBranchingStep(cv)');
        expect(body).toContain('transitionTo(BRANCH_OVERLAY_PHASE');
        expect(body.indexOf('isBranchingStep(cv)')).toBeLessThan(body.indexOf("cv?.responseType === 'viewAndContinue'"));
    });

    it('raises the branch overlay from handleError', () => {
        const body = functionSlice(source, 'handleError');
        expect(body).toContain('isBranchingStep(cv)');
        expect(body).toContain('BRANCH_OVERLAY_PHASE');
    });

    it('renders the overlay in the branch phase', () => {
        expect(source).toContain('appPhase === BRANCH_OVERLAY_PHASE');
    });
});

describe('BranchChoiceButtons separation', () => {
    const source = read('src/components/widgets/BranchChoiceButtons.jsx');

    it('imports no store, player, progression or logic module', () => {
        for (const token of [
            'appStore',
            'getCurrentVideoPlayer',
            'jumpToStep',
            'resolveBranchChoices',
            'formatBranchChoiceLabel',
            'branch-choice-logic',
        ]) {
            expect(source, `BranchChoiceButtons must not reference ${token}`).not.toContain(token);
        }
    });

    it('performs no phase transitions itself', () => {
        expect(source).not.toContain('transitionTo(');
    });
});

describe('progression and container wiring', () => {
    it('prefetches the next clip through the shared offset resolver', () => {
        expect(read('src/modules/lesson/step-executor-webonly.js')).toContain('resolveNextStepIndex(');
    });

    const container = read('src/components/LessonContainer.jsx');

    it('derives the branch view with the pure builder', () => {
        expect(container).toContain('buildBranchChoiceView(');
    });

    it('renders BranchChoiceButtons under the branchChoices bottom state with all four props', () => {
        const start = container.indexOf("bottomState === 'branchChoices'");
        expect(start, 'missing branchChoices render condition').toBeGreaterThan(-1);
        const end = container.indexOf('controlIcon', start);
        const block = container.slice(start, end === -1 ? undefined : end);
        expect(block).toContain('<BranchChoiceButtons');
        expect(block).toContain('view={');
        expect(block).toContain('onChoose={');
        expect(block).toContain('onReplay={');
        expect(block).toContain('onContinue={');
    });

    it('holds no offset math or label formatting', () => {
        expect(container).not.toContain('+ step.nextStep');
        expect(container).not.toContain('+ nextStep');
        expect(container).not.toContain('formatBranchChoiceLabel(');
    });
});

describe('StepLoader, strings and styles', () => {
    it('handles the branching response type instead of falling through to UnknownStepType', () => {
        const source = read('src/components/StepLoader.jsx');
        const start = source.indexOf('switch (step.responseType)');
        const end = source.indexOf('default:');
        const switchBody = source.slice(start, end === -1 ? undefined : end);
        expect(switchBody).toContain("case 'branching':");
    });

    it('styles the branch choice row, column and button', () => {
        const css = read('src/assets/css/app.css');
        const row = cssBlock(css, '.branch-choice-row {');
        expect(row).toContain('display: flex');
        expect(row).toContain('justify-content: space-around');
        expect(row).toContain('align-items: flex-end');
        expect(row).toContain('width: 100%');

        const col = cssBlock(css, '.branch-choice-col {');
        expect(col).toContain('display: flex');
        expect(col).toContain('flex-direction: column');
        expect(col).toContain('flex: 2 1 0');
        expect(col).toContain('justify-content: flex-end');

        const btn = cssBlock(css, '.branch-choice-btn {');
        expect(btn).toContain('width: 100%');
        expect(btn).toContain('border-radius: 8px');
        expect(btn).toContain('background:');
        expect(btn).toContain('color:');
        expect(btn).toContain('font-weight: 700');
    });

    it('ships the branch heading copy in English and Spanish', () => {
        expect(getBilingual('video_choose_how_respond', 'en').english).toBe('Choose how you will respond.');
        expect(getBilingual('video_choose_how_respond', 'es').localized).toBeTruthy();
    });
});

describe('normalizeConfig preserves branching text', () => {
    it('leaves chooseStep[].text as an object', () => {
        const configData = {
            lessons: [{
                title: 'L',
                steps: [{
                    responseType: 'branching',
                    simpleVideoUrl: 'clip',
                    chooseStep: [
                        { nextStep: 1, text: { en: 'Yes', es: 'Sí' } },
                    ],
                }],
            }],
        };
        normalizeConfig(configData, 'es');
        const text = configData.lessons[0].steps[0].chooseStep[0].text;
        expect(typeof text).toBe('object');
        expect(text).toEqual({ en: 'Yes', es: 'Sí' });
    });
});
