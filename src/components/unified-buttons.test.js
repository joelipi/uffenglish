// src/components/unified-buttons.test.js
// Source guards for the unified button style. Every solid button shares one
// basic style (white background, black icon/text, overlay shadow) and differs
// only by shape; the overlay border (1px solid #ffffff, as on
// .branch-choice-btn) appears ONLY on the primary button in a row of 2 or
// more, or on the only button in its row (e.g. the homepage CTAs). Round
// buttons opt into the border with the explicit `btn-row-primary` class;
// rectangular solid CTAs are single-or-primary by construction, so their own
// rules carry the border directly. Each guard slices the specific block it
// protects (never the whole file, never to EOF) and asserts every property.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

// A CSS rule block from its selector to the matching closing brace.
function cssBlock(src, selector) {
    const start = src.indexOf(selector);
    expect(start, `missing ${selector}`).toBeGreaterThan(-1);
    const end = src.indexOf('}', start);
    return src.slice(start, end + 1);
}

// The full `<button …>` tag containing a marker (id or icon token),
// regardless of attribute order.
function buttonTagBefore(src, marker) {
    const pos = src.indexOf(marker);
    expect(pos, `missing ${marker}`).toBeGreaterThan(-1);
    const tagStart = src.lastIndexOf('<button', pos);
    expect(tagStart, `no <button before ${marker}`).toBeGreaterThan(-1);
    const tagEnd = src.indexOf('>', tagStart);
    expect(tagEnd, `unterminated <button before ${marker}`).toBeGreaterThan(-1);
    return src.slice(tagStart, tagEnd + 1);
}

describe('unified button tokens and round base', () => {
    const css = read('src/assets/css/app.css');

    it('single-sources the shared button values', () => {
        const start = css.indexOf('UNIFIED BUTTONS');
        expect(start, 'missing UNIFIED BUTTONS section').toBeGreaterThan(-1);
        const block = css.slice(start, css.indexOf('}', start) + 1);
        expect(block).toContain('--uff-btn-bg: #ffffff');
        expect(block).toContain('--uff-btn-fg: #1a1a1a');
        expect(block).toContain('--uff-btn-border: 1px solid #ffffff');
        expect(block).toMatch(/--uff-btn-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\)/);
    });

    it('keeps round buttons borderless by default with the shared white/black style', () => {
        const shared = cssBlock(css, '.call-btn,\n.call-icon {');
        expect(shared).toContain('border-radius: 50% !important');
        expect(shared).toContain('border: none !important');
        const btn = cssBlock(css, '.call-btn {');
        expect(btn).toContain('background-color: #ffffff !important');
        expect(btn).toContain('color: #1a1a1a !important');
        expect(btn).toMatch(/box-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\)/);
    });

    it('gives mode icons the same white/black basic style without a border', () => {
        // The standalone rule (not the shared `.call-btn, .call-icon` block):
        // anchor on its unique first declaration.
        const icon = cssBlock(css, '.call-icon {\n    background-color: #ffffff !important;');
        expect(icon).toContain('color: #1a1a1a !important');
        expect(icon).toMatch(/box-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\) !important/);
        expect(icon).not.toContain('transparent');
    });

    it('reserves the overlay border for the row-primary marker', () => {
        const marker = cssBlock(css, '.btn-row-primary {');
        expect(marker).toContain('border: 1px solid #ffffff');
    });
});

describe('rectangular CTAs carry the overlay border', () => {
    const css = read('src/assets/css/app.css');

    it('paints solid theme buttons white with the overlay border', () => {
        for (const selector of ['.btn-primary {', '.btn-secondary {', '.btn-success {']) {
            const block = cssBlock(css, selector);
            expect(block).toContain('--bs-btn-bg: #ffffff');
            expect(block).toContain('--bs-btn-color: #1a1a1a');
            expect(block).toContain('--bs-btn-border-color: #ffffff');
            expect(block).toMatch(/box-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\)/);
        }
    });

    it('keeps the overlay reference button white with a rounded-corner border', () => {
        const btn = cssBlock(css, '.branch-choice-btn {');
        expect(btn).toMatch(/background:\s*#ffffff/);
        expect(btn).toContain('border: 1px solid #ffffff');
        expect(btn).toContain('border-radius: 8px');
        expect(btn).toMatch(/box-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\)/);
    });

    it('borders the single-button round actions', () => {
        const submit = cssBlock(css, '#answer-submit-button {');
        expect(submit).toContain('background-color: #ffffff !important');
        expect(submit).toContain('border: 1px solid #ffffff !important');
        expect(submit).toContain('border-radius: 50% !important');
        const incoming = cssBlock(css, '.incoming-video-btn {');
        expect(incoming).toContain('background-color: #ffffff');
        expect(incoming).toContain('border: 1px solid #ffffff');
        expect(incoming).toContain('border-radius: 50%');
    });
});

describe('homepage buttons follow the single-or-primary border rule', () => {
    const css = read('src/components/homescreen/home-landing.css');

    it('borders the single-call actions with rounded corners or round shape', () => {
        const primary = cssBlock(css, '.uff-home-bs .btn-uff-primary {');
        expect(primary).toContain('background-color: #ffffff');
        expect(primary).toContain('border: 1px solid #ffffff');
        expect(primary).toContain('border-radius: 8px');
        const topbar = cssBlock(css, '.uff-home-bs .btn-uff-topbar {');
        expect(topbar).toContain('background-color: #ffffff');
        expect(topbar).toContain('border: 1px solid #ffffff');
        const play = cssBlock(css, '.uff-carousel-play {');
        expect(play).toContain('background: #ffffff');
        expect(play).toContain('border: 1px solid #ffffff');
        expect(play).toContain('border-radius: 50%');
    });

    it('keeps the equal-pair carousel nav borderless in the shared white/black style', () => {
        const nav = cssBlock(css, '.uff-carousel-nav {');
        expect(nav).toContain('background: #ffffff');
        expect(nav).toContain('color: #1a1a1a');
        expect(nav).toContain('border-radius: 50%');
        expect(nav).toContain('border: none');
        expect(nav).not.toContain('1px solid #ffffff');
        expect(nav).not.toContain('rgba(11, 26, 42');
    });
});

describe('round primaries are marked, secondaries are not', () => {
    it('marks the primary round button in each multi-button row', () => {
        expect(buttonTagBefore(read('src/components/widgets/ViewAndContinueButtons.jsx'), 'id="continueBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/widgets/IntroChoices.jsx'), 'id="continueButton"')).toContain('btn-row-primary');
        const success = read('src/components/widgets/SuccessButtons.jsx');
        expect(buttonTagBefore(success, 'id="processBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(success, 'id="createVideoButton"')).toContain('btn-row-primary');
        const response = read('src/components/widgets/ResponseDecisionButtons.jsx');
        expect(buttonTagBefore(response, 'id="responseAnswerBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(response, 'id="responseTxtBtn"')).toContain('btn-row-primary');
        const mic = read('src/components/widgets/MicrophoneToggle.web.jsx');
        expect(buttonTagBefore(mic, 'id="micBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(mic, 'id="txtBtn"')).toContain('btn-row-primary');
        const decision = read('src/components/widgets/DecisionButtons.jsx');
        expect(buttonTagBefore(decision, 'id="micBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(decision, 'id="txtBtn"')).toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/LessonContainer.jsx'), 'phaseData?.onAccept')).toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/widgets/TutorialModal.jsx'), 'bi bi-x-lg me-2')).toContain('btn-row-primary');
    });

    it('leaves secondary round buttons borderless', () => {
        expect(buttonTagBefore(read('src/components/widgets/ViewAndContinueButtons.jsx'), 'id="replayBtn"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/widgets/ViewAndContinueButtons.jsx'), 'id="tutorialBtn"')).not.toContain('btn-row-primary');
        const branch = read('src/components/widgets/BranchChoiceButtons.jsx');
        expect(buttonTagBefore(branch, 'id="branchReplayBtn"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(branch, 'id="branchTutorialBtn"')).not.toContain('btn-row-primary');
        const response = read('src/components/widgets/ResponseDecisionButtons.jsx');
        expect(buttonTagBefore(response, 'id="responseReplayBtn"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(response, 'id="responseTutorialBtn"')).not.toContain('btn-row-primary');
        const intro = read('src/components/widgets/IntroChoices.jsx');
        expect(buttonTagBefore(intro, 'id="audioOnlyButton"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(intro, 'id="textOnlyButton"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/widgets/DecisionButtons.jsx'), 'id="earBtn"')).not.toContain('btn-row-primary');
        const success = read('src/components/widgets/SuccessButtons.jsx');
        expect(buttonTagBefore(success, 'id="repeatButtonSuccess"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(success, 'id="continueButtonSuccess"')).not.toContain('btn-row-primary');
        expect(buttonTagBefore(read('src/components/LessonContainer.jsx'), 'phaseData?.onReject')).not.toContain('btn-row-primary');
    });
});

describe('inline CTA styles match the unified bordered treatment', () => {
    it('styles the home continue button white with the overlay border', () => {
        const src = read('src/components/homescreen/HomeScreen.jsx');
        const start = src.indexOf('const continueBtnStyle');
        expect(start, 'missing continueBtnStyle').toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('};', start) + 2);
        expect(block).toContain("background: '#ffffff'");
        expect(block).toContain("border: '1px solid #ffffff'");
        expect(block).toContain("borderRadius: '8px'");
        expect(block).not.toContain('brandGradient');
    });

    it('styles profile primary buttons white with the overlay border', () => {
        const src = read('src/components/profile/UserProfile.jsx');
        const start = src.indexOf('const btnPrimaryStyle');
        expect(start, 'missing btnPrimaryStyle').toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('};', start) + 2);
        expect(block).toContain("backgroundColor: '#ffffff'");
        expect(block).toContain("border: '1px solid #ffffff'");
        expect(block).not.toContain('#007bff');
    });
});
