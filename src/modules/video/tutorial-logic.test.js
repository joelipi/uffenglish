import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    TUTORIAL_STEP_TYPES,
    TUTORIAL_MODAL_IDS,
    TUTORIAL_SCRIPTS,
    TUTORIAL_VIDEO_WIDTH,
    TUTORIAL_VIDEO_HEIGHT,
    isTutorialStepType,
    shouldCloseOnBackdropClick,
    shouldCloseOnEscape,
    getTutorialSlug,
    getTutorialVideoUrl,
    getTutorialScript,
    getTutorialSubtitleLang,
    getTutorialSubtitleText,
    buildTutorialModalView,
} from './tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'tutorial-logic.js'), 'utf8');

describe('isTutorialStepType', () => {
    it.each(TUTORIAL_STEP_TYPES)('accepts %s', (t) => {
        expect(isTutorialStepType(t)).toBe(true);
    });

    it.each(['lessonIntro', 'success', 'mystery', '', 'viewandcontinue', null, undefined, 42, {}])(
        'rejects %p', (t) => {
            expect(isTutorialStepType(t)).toBe(false);
        }
    );
});

describe('getTutorialSlug', () => {
    it.each([
        ['viewAndContinue', 'tutorial-viewAndContinue'],
        ['closedResponse', 'tutorial-closedResponse'],
        ['openResponse', 'tutorial-openResponse'],
        ['friendClosedResponse', 'tutorial-friendClosedResponse'],
        ['branching', 'tutorial-branching'],
    ])('maps %s -> %s', (stepType, slug) => {
        expect(getTutorialSlug(stepType)).toBe(slug);
    });

    it.each(['lessonIntro', 'success', '', 'unknown', null, undefined, 7])(
        'returns null for %p', (stepType) => {
            expect(getTutorialSlug(stepType)).toBeNull();
        }
    );

    it('prefixes every slug so lesson content slugs can never collide', () => {
        for (const stepType of TUTORIAL_STEP_TYPES) {
            expect(getTutorialSlug(stepType).startsWith('tutorial-')).toBe(true);
        }
    });
});

describe('getTutorialVideoUrl', () => {
    it('delegates to getVideoUrl for each supported type', () => {
        expect(getTutorialVideoUrl('viewAndContinue')).toBe(
            `${import.meta.env.DEV ? '' : 'https://r2.ultrafastfluency.com'}/assets/videos/tutorial-viewAndContinue.mp4`
        );
        expect(getTutorialVideoUrl('branching')).toContain('assets/videos/tutorial-branching.mp4');
    });

    it('is empty for unsupported types', () => {
        expect(getTutorialVideoUrl('lessonIntro')).toBe('');
        expect(getTutorialVideoUrl(null)).toBe('');
    });
});

describe('getTutorialScript - new-user, 10-30 s, dismiss reminder', () => {
    it.each(TUTORIAL_STEP_TYPES)('%s is 25-75 words', (stepType) => {
        const script = getTutorialScript(stepType);
        const words = script.trim().split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(25);
        expect(words).toBeLessThanOrEqual(75);
    });

    it.each(TUTORIAL_STEP_TYPES)('%s ends with the dismiss reminder', (stepType) => {
        expect(getTutorialScript(stepType).endsWith('and get to work.')).toBe(true);
    });

    it('returns null for unsupported types', () => {
        expect(getTutorialScript('success')).toBeNull();
        expect(getTutorialScript(undefined)).toBeNull();
    });

    it('ships every script with en and es/pt/fr translations', () => {
        for (const entry of Object.values(TUTORIAL_SCRIPTS)) {
            expect(entry.en).toBeTruthy();
            expect(entry.es).toBeTruthy();
            expect(entry.pt).toBeTruthy();
            expect(entry.fr).toBeTruthy();
        }
    });

    it('keeps the five supported step types and nothing else', () => {
        expect(Object.keys(TUTORIAL_SCRIPTS).sort()).toEqual([...TUTORIAL_STEP_TYPES].sort());
    });
});

describe('modal policy', () => {
    it('exposes the shared element ids', () => {
        expect(TUTORIAL_MODAL_IDS).toEqual({
            overlay: 'tutorial-modal-overlay',
            video: 'tutorialVideo',
            close: 'tutorialCloseBtn',
            continue: 'tutorialContinueBtn',
        });
    });

    it('closes on backdrop click and on Escape', () => {
        expect(shouldCloseOnBackdropClick()).toBe(true);
        expect(shouldCloseOnEscape()).toBe(true);
    });

    it('is portrait 9:16', () => {
        expect(TUTORIAL_VIDEO_WIDTH).toBe(720);
        expect(TUTORIAL_VIDEO_HEIGHT).toBe(1280);
        expect(TUTORIAL_VIDEO_HEIGHT / TUTORIAL_VIDEO_WIDTH).toBeCloseTo(16 / 9, 5);
    });
});

describe('getTutorialSubtitleLang', () => {
    it('normalizes case and region', () => {
        expect(getTutorialSubtitleLang('es')).toBe('es');
        expect(getTutorialSubtitleLang('EN')).toBe('en');
        expect(getTutorialSubtitleLang('pt-BR')).toBe('pt');
    });

    it('falls back to en for empty/unknown/non-string', () => {
        expect(getTutorialSubtitleLang('')).toBe('en');
        expect(getTutorialSubtitleLang(null)).toBe('en');
        expect(getTutorialSubtitleLang(undefined)).toBe('en');
        expect(getTutorialSubtitleLang(123)).toBe('en');
    });

    it('maps the guest "language not listed" sentinel (OTHER) to en', () => {
        expect(getTutorialSubtitleLang('OTHER')).toBe('en');
        expect(getTutorialSubtitleLang('other')).toBe('en');
        expect(getTutorialSubtitleText('branching', 'OTHER')).toBe(getTutorialScript('branching'));
    });
});

describe('getTutorialSubtitleText - guest-first session language', () => {
    it.each(['es', 'pt', 'fr'])('translates %s', (lang) => {
        const text = getTutorialSubtitleText('closedResponse', lang);
        expect(text).toBe(TUTORIAL_SCRIPTS.closedResponse[lang]);
        expect(text).not.toBe(getTutorialScript('closedResponse'));
    });

    it('es, pt and fr are three different strings', () => {
        const es = getTutorialSubtitleText('viewAndContinue', 'es');
        const pt = getTutorialSubtitleText('viewAndContinue', 'pt');
        const fr = getTutorialSubtitleText('viewAndContinue', 'fr');
        expect(es).not.toBe(pt);
        expect(es).not.toBe(fr);
        expect(pt).not.toBe(fr);
    });

    it('mentions the localized Continue label word', () => {
        expect(getTutorialSubtitleText('viewAndContinue', 'es')).toContain('Continuar');
        expect(getTutorialSubtitleText('viewAndContinue', 'pt')).toContain('Continuar');
        expect(getTutorialSubtitleText('viewAndContinue', 'fr')).toContain('Continuer');
    });

    it('is the English script for en and for untranslated/unknown languages', () => {
        for (const lang of ['en', 'EN', 'hi', 'bn', 'xx', '', null, undefined, 42]) {
            expect(getTutorialSubtitleText('branching', lang)).toBe(getTutorialScript('branching'));
        }
    });

    it('returns null for unsupported step types', () => {
        expect(getTutorialSubtitleText('lessonIntro', 'es')).toBeNull();
        expect(getTutorialSubtitleText('success', 'es')).toBeNull();
        expect(getTutorialSubtitleText('', 'es')).toBeNull();
        expect(getTutorialSubtitleText(null, 'es')).toBeNull();
    });

    it('normalizes a region-qualified guest language (pt-BR -> pt)', () => {
        expect(getTutorialSubtitleText('branching', 'pt-BR')).toBe(TUTORIAL_SCRIPTS.branching.pt);
    });
});

describe('buildTutorialModalView', () => {
    it('resolves everything the component renders for a supported type', () => {
        const view = buildTutorialModalView({ stepType: 'branching', lang: 'es' });
        expect(view.isSupported).toBe(true);
        expect(view.stepType).toBe('branching');
        expect(view.videoUrl).toContain('assets/videos/tutorial-branching.mp4');
        expect(view.subtitleText).toBe(TUTORIAL_SCRIPTS.branching.es);
        expect(view.subtitleLang).toBe('es');
        expect(view.closesOnBackdropClick).toBe(true);
        expect(view.closesOnEscape).toBe(true);
        expect(view.ids).toBe(TUTORIAL_MODAL_IDS);
    });

    it('marks unsupported types so the caller opens nothing', () => {
        const view = buildTutorialModalView({ stepType: 'success', lang: 'es' });
        expect(view.isSupported).toBe(false);
        expect(view.videoUrl).toBe('');
        expect(view.script).toBeNull();
        expect(view.subtitleText).toBeNull();
    });
});

// Purity: the module must stay logic-only so the component is render-only and
// the rules stay unit-testable (repo "Logic / presentation separation" rule).
describe('purity', () => {
    it('imports getVideoUrl from ./video-url.js', () => {
        expect(source).toContain("from './video-url.js'");
        expect(source).toContain('getVideoUrl');
    });

    it('imports no React, React Native, or DOM globals', () => {
        expect(source).not.toMatch(/from ['"]react['"]/);
        expect(source).not.toMatch(/from ['"]react-dom['"]/);
        expect(source).not.toMatch(/from ['"]react-native['"]/);
        expect(source).not.toMatch(/\bwindow\./);
        expect(source).not.toMatch(/\bdocument\./);
        expect(source).not.toMatch(/\bnavigator\./);
    });

    it('contains no JSX', () => {
        // JSX would bring className= or a closing tag into a pure logic module
        // (asserted on raw source). Identifier checks (`React`) run on a
        // comment-stripped copy so this module's own "No React" doc comment is
        // not mistaken for an import (docs/learnings.md).
        expect(source).not.toContain('className=');
        expect(source).not.toContain('</');

        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toContain('React');
        expect(code).not.toContain('.jsx');
    });
});
