import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    TUTORIAL_TOPICS,
    FRIEND_RECORDING_PREVIEW_TOPIC,
    TUTORIAL_MODAL_IDS,
    TUTORIAL_SCRIPTS,
    TUTORIAL_VIDEO_WIDTH,
    TUTORIAL_VIDEO_HEIGHT,
    isTutorialTopic,
    getTutorialSlug,
    getTutorialVideoUrl,
    getTutorialScript,
    getTutorialSubtitleLang,
    getTutorialSubtitleText,
    buildTutorialModalView,
    createTutorialModalHandlers,
} from './tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'tutorial-logic.js'), 'utf8');

describe('isTutorialTopic', () => {
    it.each(TUTORIAL_TOPICS)('accepts %s', (t) => {
        expect(isTutorialTopic(t)).toBe(true);
    });

    it.each(['lessonIntro', 'success', 'mystery', '', 'viewandcontinue', null, undefined, 42, {}])(
        'rejects %p', (t) => {
            expect(isTutorialTopic(t)).toBe(false);
        }
    );

    it('accepts the recording-preview topic even though it is not a step type', () => {
        expect(FRIEND_RECORDING_PREVIEW_TOPIC).toBe('friendRecordingPreview');
        expect(isTutorialTopic(FRIEND_RECORDING_PREVIEW_TOPIC)).toBe(true);
    });
});

describe('getTutorialSlug', () => {
    it.each([
        ['viewAndContinue', 'tutorial-viewAndContinue'],
        ['closedResponse', 'tutorial-closedResponse'],
        ['openResponse', 'tutorial-openResponse'],
        ['friendClosedResponse', 'tutorial-friendClosedResponse'],
        ['friendRecordingPreview', 'tutorial-friendRecordingPreview'],
        ['branching', 'tutorial-branching'],
    ])('maps %s -> %s', (topic, slug) => {
        expect(getTutorialSlug(topic)).toBe(slug);
    });

    it.each(['lessonIntro', 'success', '', 'unknown', null, undefined, 7])(
        'returns null for %p', (topic) => {
            expect(getTutorialSlug(topic)).toBeNull();
        }
    );

    it('prefixes every slug so lesson content slugs can never collide', () => {
        for (const topic of TUTORIAL_TOPICS) {
            expect(getTutorialSlug(topic).startsWith('tutorial-')).toBe(true);
        }
    });
});

describe('getTutorialVideoUrl', () => {
    it('delegates to getVideoUrl for each supported type', () => {
        expect(getTutorialVideoUrl('viewAndContinue')).toBe(
            `${import.meta.env.DEV ? '' : 'https://r2.ultrafastfluency.com'}/assets/videos/tutorial-viewAndContinue.mp4`
        );
        expect(getTutorialVideoUrl('branching')).toContain('assets/videos/tutorial-branching.mp4');
        expect(getTutorialVideoUrl(FRIEND_RECORDING_PREVIEW_TOPIC)).toContain('assets/videos/tutorial-friendRecordingPreview.mp4');
    });

    it('is empty for unsupported types', () => {
        expect(getTutorialVideoUrl('lessonIntro')).toBe('');
        expect(getTutorialVideoUrl(null)).toBe('');
    });
});

describe('getTutorialScript - new-user, 10-30 s, dismiss reminder', () => {
    it.each(TUTORIAL_TOPICS)('%s is 25-75 words', (topic) => {
        const script = getTutorialScript(topic);
        const words = script.trim().split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(25);
        expect(words).toBeLessThanOrEqual(75);
    });

    it.each(TUTORIAL_TOPICS)('%s ends with the dismiss reminder', (topic) => {
        expect(getTutorialScript(topic).endsWith('and get to work.')).toBe(true);
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

    it('keeps exactly the supported topics and nothing else', () => {
        expect(Object.keys(TUTORIAL_SCRIPTS).sort()).toEqual([...TUTORIAL_TOPICS].sort());
    });

    it('has a distinct preview guide that names the camera-screen controls', () => {
        const script = getTutorialScript(FRIEND_RECORDING_PREVIEW_TOPIC);
        expect(script).toContain('recording screen');
        for (const label of ['Filter', 'Lens', 'Screen', 'Top', 'Face', 'Bottom', 'Emoji', 'Size']) {
            expect(script).toContain(label);
        }
        expect(script).toContain('microphone');
    });
});

describe('modal constants', () => {
    it('exposes the shared element ids', () => {
        expect(TUTORIAL_MODAL_IDS).toEqual({
            overlay: 'tutorial-modal-overlay',
            video: 'tutorialVideo',
            close: 'tutorialCloseBtn',
            continue: 'tutorialContinueBtn',
        });
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

    it('translates the recording-preview guide and falls back to English for hi/bn', () => {
        for (const lang of ['es', 'pt', 'fr']) {
            expect(getTutorialSubtitleText(FRIEND_RECORDING_PREVIEW_TOPIC, lang))
                .toBe(TUTORIAL_SCRIPTS.friendRecordingPreview[lang]);
        }
        const es = getTutorialSubtitleText(FRIEND_RECORDING_PREVIEW_TOPIC, 'es');
        const pt = getTutorialSubtitleText(FRIEND_RECORDING_PREVIEW_TOPIC, 'pt');
        const fr = getTutorialSubtitleText(FRIEND_RECORDING_PREVIEW_TOPIC, 'fr');
        expect(es).not.toBe(pt);
        expect(es).not.toBe(fr);
        expect(pt).not.toBe(fr);
        for (const lang of ['en', 'hi', 'bn', 'xx', null]) {
            expect(getTutorialSubtitleText(FRIEND_RECORDING_PREVIEW_TOPIC, lang))
                .toBe(TUTORIAL_SCRIPTS.friendRecordingPreview.en);
        }
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
        const view = buildTutorialModalView({ topic: 'branching', lang: 'es' });
        expect(view.isSupported).toBe(true);
        expect(view.topic).toBe('branching');
        expect(view.videoUrl).toContain('assets/videos/tutorial-branching.mp4');
        expect(view.subtitleText).toBe(TUTORIAL_SCRIPTS.branching.es);
        expect(view.subtitleLang).toBe('es');
    });

    it('resolves the recording-preview screen to its own video and script', () => {
        const view = buildTutorialModalView({ topic: FRIEND_RECORDING_PREVIEW_TOPIC, lang: 'pt' });
        expect(view.isSupported).toBe(true);
        expect(view.topic).toBe(FRIEND_RECORDING_PREVIEW_TOPIC);
        expect(view.videoUrl).toContain('assets/videos/tutorial-friendRecordingPreview.mp4');
        expect(view.subtitleText).toBe(TUTORIAL_SCRIPTS.friendRecordingPreview.pt);
        expect(view.subtitleLang).toBe('pt');
    });

    it('marks unsupported types so the caller opens nothing', () => {
        const view = buildTutorialModalView({ topic: 'success', lang: 'es' });
        expect(view.isSupported).toBe(false);
        expect(view.videoUrl).toBe('');
        expect(view.subtitleText).toBeNull();
    });
});

describe('createTutorialModalHandlers', () => {
    it('closes from the overlay and ignores a missing onClose', () => {
        const onClose = vi.fn();
        const handlers = createTutorialModalHandlers({ onClose });
        handlers.handleOverlayClick();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(() => createTutorialModalHandlers({}).handleOverlayClick()).not.toThrow();
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
