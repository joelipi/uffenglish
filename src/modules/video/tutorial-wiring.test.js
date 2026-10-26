// src/modules/video/tutorial-wiring.test.js
// Static guards for the tutorial modal's wiring and its stylesheet contract.
// The modal's dismissal, portrait geometry and Playwright flows are covered in
// tests/tutorial-modal.spec.js on real Chrome; this file locks the contracts
// that only exist as source text: which step type reaches each row, that the
// pause helper exists and is wired, that the component stays render-only, and
// that app.css carries the takeover/portrait/corner-X rules. All assertions
// read RAW source (never comment-stripped — docs/learnings.md) and slice to the
// specific block they protect.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TUTORIAL_MODAL_IDS } from './tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const modal = read('src/components/widgets/TutorialModal.jsx');
const viewAndContinue = read('src/components/widgets/ViewAndContinueButtons.jsx');
const responseRow = read('src/components/widgets/ResponseDecisionButtons.jsx');
const branchRow = read('src/components/widgets/BranchChoiceButtons.jsx');
const webcamPreview = read('src/components/widgets/WebcamPreview.jsx');
const previewTutorial = read('src/components/widgets/PreviewTutorialButton.jsx');
const progression = read('src/modules/lesson/lesson-progression.js');
const css = read('src/assets/css/app.css');

// A CSS rule block from its line-start selector to the closing brace. The
// leading '\n' anchor stops `.tutorial-modal-close {` matching
// `.tutorial-modal-close:hover {`.
function cssBlock(selector) {
    const start = css.indexOf(`\n${selector}`);
    expect(start, `app.css is missing the ${selector} rule`).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    expect(end, `${selector} has no closing brace`).toBeGreaterThan(start);
    return css.slice(start, end + 1);
}

describe('TutorialModal stays render-only', () => {
    it('takes topic and onClose only, and resolves the rest from the logic module', () => {
        expect(modal).toContain("from '../../modules/video/tutorial-logic.js'");
        expect(modal).toContain('buildTutorialModalView(');
        expect(modal).toContain('export default function TutorialModal({ topic, onClose }) {');
    });

    it('never builds a slug, URL or subtitle text itself', () => {
        // The component must not construct a tutorial slug or URL (that rule
        // lives in the logic module); class names like "tutorial-modal-close"
        // are styling, not slugs.
        expect(modal).not.toContain('getVideoUrl');
        expect(modal).not.toMatch(/tutorial-\$\{/);
        expect(modal).not.toContain('/assets/videos/');
        expect(modal).not.toContain('TUTORIAL_SLUG_PREFIX');
    });

    it('never reads the store or the browser language directly', () => {
        expect(modal).not.toContain('appStore.getState()');
        expect(modal).not.toContain('navigator.language');
        expect(modal).not.toContain('navigator.languages');
    });

    it('shows the corner X, the portrait video and the localized Continue', () => {
        expect(modal).toContain('id="tutorialCloseBtn"');
        expect(modal).toContain('<i className="bi bi-x-lg"></i>');
        expect(modal).toContain('id="tutorialVideo"');
        expect(modal).toContain('src={view.videoUrl}');
        expect(modal).toContain('id="tutorialContinueBtn"');
        // No autoplay, controls are learner-driven (tap to play).
        expect(modal).not.toContain('autoplay');
    });

    it('renders exactly the ids the logic module publishes (no silent drift)', () => {
        for (const id of Object.values(TUTORIAL_MODAL_IDS)) {
            expect(modal).toContain(`id="${id}"`);
        }
    });

    it('renders the subtitle band over the video with the session language', () => {
        expect(modal).toContain('ivp-subtitle-scroll-container tutorial-modal-subtitles');
        expect(modal).toContain('ivp-subtitles tutorial-modal-subtitle-text');
        expect(modal).toContain('lang={view.subtitleLang}');
    });
});

describe('each decision row passes its own tutorial topic', () => {
    it('view-and-continue row opens the viewAndContinue tutorial', () => {
        const invocation = viewAndContinue.slice(
            viewAndContinue.indexOf('<TutorialModal'),
            viewAndContinue.indexOf('</TutorialModal>')
        );
        expect(invocation).toContain("topic=\"viewAndContinue\"");
        expect(viewAndContinue).toContain('createTutorialOpener(');
    });

    it('branching row opens the branching tutorial', () => {
        const invocation = branchRow.slice(
            branchRow.indexOf('<TutorialModal'),
            branchRow.indexOf('</TutorialModal>')
        );
        expect(invocation).toContain("topic=\"branching\"");
        expect(branchRow).toContain('createTutorialOpener(');
    });

    it('response row opens the tutorial of the step it decided', () => {
        const invocation = responseRow.slice(
            responseRow.indexOf('<TutorialModal'),
            responseRow.indexOf('</TutorialModal>')
        );
        expect(invocation).toContain('topic={currentVideo?.responseType}');
        expect(responseRow).toContain('createTutorialOpener(');
    });
});

// The pause must have exactly one call site. Previously every row called it
// *and* the modal's mount effect did too, so removing either stayed green.
describe('the lesson pause has a single call site (the modal mount effect)', () => {
    it('is called from TutorialModal, never from a decision row', () => {
        expect(modal).toContain('pauseLessonVideoForTutorial();');
        expect(viewAndContinue).not.toContain('pauseLessonVideoForTutorial');
        expect(responseRow).not.toContain('pauseLessonVideoForTutorial');
        expect(branchRow).not.toContain('pauseLessonVideoForTutorial');
    });
});

describe('pauseLessonVideoForTutorial', () => {
    it('is defined, exported and stops both the registered player and every video', () => {
        expect(progression).toContain('function pauseLessonVideoForTutorial()');
        expect(progression).toContain('export function pauseLessonVideoForTutorial()');
        expect(progression).toContain('getCurrentVideoPlayer()');
        expect(progression).toContain('triggerPauseAllVideos()');

        // Order inside the function: pause the player first, then the store
        // trigger (presence alone is not containment — docs/learnings.md).
        const fn = progression.slice(
            progression.indexOf('function pauseLessonVideoForTutorial()'),
            progression.indexOf('function loadNextLesson(')
        );
        expect(fn).toContain('getCurrentVideoPlayer()');
        expect(fn).toContain('triggerPauseAllVideos()');
        expect(fn.indexOf('player.pause()')).toBeGreaterThan(-1);
        expect(fn.indexOf('player.pause()')).toBeLessThan(fn.indexOf('triggerPauseAllVideos()'));

        // It is reachable from the progression instance the rows call.
        expect(progression).toContain('replaySimpleVideo, pauseLessonVideoForTutorial, loadNextLesson');
    });
});

describe('every tutorial button uses the question-mark help icon', () => {
    it.each([
        ['view-and-continue', viewAndContinue, 'tutorialBtn'],
        ['response', responseRow, 'responseTutorialBtn'],
        ['branching', branchRow, 'branchTutorialBtn'],
        ['recording preview', previewTutorial, 'previewTutorialBtn'],
    ])('%s row renders the help icon, not the old book icon', (_row, source, id) => {
        const start = source.indexOf(`id="${id}"`);
        expect(start, `${id} button not found`).toBeGreaterThan(-1);
        const button = source.slice(start, source.indexOf('</button>', start));
        expect(button).toContain('bi bi-question-circle-fill');
        expect(button).not.toContain('bi-book-fill');
    });
});

describe('the recording-preview screen has its own guide', () => {
    it('WebcamPreview renders the guide only while the preview gate is open', () => {
        expect(webcamPreview).toContain("import PreviewTutorialButton from './PreviewTutorialButton.jsx'");
        // The gate is the same one that shows the look rail: awaiting the take
        // AND a friendClosedResponse step. Sliced to the assignment so a second,
        // unguarded render cannot hide behind this one.
        const gateStart = webcamPreview.indexOf('const lookControlsVisible');
        const gateEnd = webcamPreview.indexOf('\n', gateStart);
        const gate = webcamPreview.slice(gateStart, gateEnd);
        expect(gate).toContain('awaitingStart');
        expect(gate).toContain('isPreviewGateStep(currentStep)');
        expect(webcamPreview).toContain('{lookControlsVisible && <PreviewTutorialButton />}');
        // Exactly one render site, and it is the guarded one.
        expect(webcamPreview.match(/<PreviewTutorialButton \/>/g)).toHaveLength(1);
    });

    it('PreviewTutorialButton owns only the modal state and points at its own topic', () => {
        expect(previewTutorial).toContain("from '../../modules/video/tutorial-logic.js'");
        expect(previewTutorial).toContain('createTutorialOpener(');
        expect(previewTutorial).toContain('FRIEND_RECORDING_PREVIEW_TOPIC');
        expect(previewTutorial).toContain('topic: FRIEND_RECORDING_PREVIEW_TOPIC');
        expect(previewTutorial).toContain('topic={FRIEND_RECORDING_PREVIEW_TOPIC}');
        expect(previewTutorial).toContain('id="previewTutorialBtn"');
        expect(previewTutorial).toContain('bi bi-question-circle-fill');
        // Same render-only contract as the decision rows: no slug/URL building.
        expect(previewTutorial).not.toContain('getVideoUrl');
        expect(previewTutorial).not.toContain('TUTORIAL_SLUG_PREFIX');
        expect(previewTutorial).not.toContain('/assets/videos/');
        expect(previewTutorial).not.toContain('appStore.getState()');
    });

    it('the button is styled to clear the rail, phrase and microphone', () => {
        const block = cssBlock('.preview-tutorial-btn {');
        expect(block).toContain('position: absolute');
        expect(block).toContain('right: 16px');
        expect(block).toContain('bottom: calc(32px + env(safe-area-inset-bottom, 0px))');
        expect(block).toContain('z-index: 1100');
        expect(block).toContain('width: 48px');
        expect(block).toContain('height: 48px');
    });
});

describe('app.css carries the tutorial takeover stylesheet', () => {
    it('overlays the whole viewport and scrolls', () => {
        const block = cssBlock('.tutorial-modal-overlay {');
        expect(block).toContain('position: fixed');
        expect(block).toContain('inset: 0');
        expect(block).toContain('z-index: 9999');
        expect(block).toContain('rgba(0, 0, 0, 0.8)');
        // The takeover is scrollable even when the content is taller than the
        // phone viewport (the small-phone case).
        expect(block).toContain('overflow-y: auto');
    });

    it('lets the card scroll instead of overflowing the takeover', () => {
        const block = cssBlock('.tutorial-modal-content {');
        expect(block).toContain('max-height: 90vh');
        expect(block).toContain('overflow-y: auto');
        expect(block).toContain('#1a3a5a');
    });

    it('pins a prominent X to the upper-right corner, styled like #closePage', () => {
        const closePage = cssBlock('#closePage {');
        const closeBlock = cssBlock('.tutorial-modal-close {');
        expect(closeBlock).toContain('position: absolute');
        expect(closeBlock).toContain('top: 0.5rem');
        expect(closeBlock).toContain('right: 0.5rem');
        // Same white 1.5rem treatment as the app's close X.
        expect(closeBlock).toContain(`color: ${closePage.split('color:')[1].split(';')[0].trim()}`);
        expect(closeBlock).toContain(`font-size: ${closePage.split('font-size:')[1].split(';')[0].trim()}`);
    });

    it('renders the video portrait 9:16 full width', () => {
        const block = cssBlock('.tutorial-modal-video {');
        expect(block).toContain('width: 100%');
        expect(block).toContain('aspect-ratio: 9 / 16');
    });

    it('keeps the subtitle band inside the video wrapper', () => {
        const block = cssBlock('.tutorial-modal-video-wrap .tutorial-modal-subtitles.ivp-subtitle-scroll-container {');
        expect(block).toContain('position: absolute');
        expect(block).toContain('bottom: 0');
    });

    it('styles Continue as the homepage primary CTA, never a round call button', () => {
        const block = cssBlock('.tutorial-modal-continue {');
        // Mirrors .uff-home-bs .btn-uff-primary (home-landing.css): white
        // solid, dark bold text, 8px rectangle, generous padding.
        expect(block).toContain('background-color: var(--uff-btn-bg)');
        expect(block).toContain('border: var(--uff-btn-border)');
        expect(block).toContain('color: var(--uff-btn-fg)');
        expect(block).toContain('border-radius: 8px');
        expect(block).toContain('font-weight: 700');
        expect(block).toContain('padding: 0.875rem 1.25rem');
        // The round .call-btn geometry would crush the label into a circle.
        expect(block).not.toContain('border-radius: 50%');
        expect(block).not.toContain('aspect-ratio');
        // The white halo edge comes from the shared static-halo group, and it
        // never pulses (static form button, like the homepage primaries).
        expect(css).toContain('.tutorial-modal-continue::before');
        expect(cssBlock('.tutorial-modal-continue::before {')).toContain('animation: none');
    });
});
