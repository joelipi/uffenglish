// src/components/unified-buttons.test.js
// Source guards for the unified button style. Every solid button shares one
// basic style (white background, black icon/text, overlay shadow, all
// single-sourced from the --uff-btn-* tokens) and differs only by shape; the
// overlay border appears ONLY on the primary button in a row of 2 or more, or
// on the only button in its row (e.g. the homepage CTAs). Round buttons opt
// into the border with the explicit `btn-row-primary` class; rectangular solid
// CTAs are single-or-primary by construction, so their own rules carry the
// border directly. Each guard slices the specific block it protects (never the
// whole file, never to EOF) and asserts every property.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

// A CSS rule block from its line-start selector to the closing brace.
// Anchored with '\n' so `.call-btn {` cannot match `.call-btn:hover {`.
function cssBlock(src, selector) {
    const start = src.indexOf(`\n${selector}`);
    expect(start, `missing ${selector}`).toBeGreaterThan(-1);
    const end = src.indexOf('}', start);
    return src.slice(start, end + 1);
}

// The full `<button …>` tag containing a marker (id or icon token),
// regardless of attribute order. The end is scanned quote- and brace-aware
// so a `>` inside `onClick={() => ...}` cannot truncate the slice.
function buttonTag(src, marker) {
    const pos = src.indexOf(marker);
    expect(pos, `missing ${marker}`).toBeGreaterThan(-1);
    const tagStart = src.lastIndexOf('<button', pos);
    expect(tagStart, `no <button before ${marker}`).toBeGreaterThan(-1);
    let i = tagStart;
    let quote = null;
    let depth = 0;
    for (; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
        } else if (ch === '>' && depth === 0) {
            break;
        }
    }
    expect(i, `unterminated <button before ${marker}`).toBeLessThan(src.length);
    const tag = src.slice(tagStart, i + 1);
    expect(tag, `tag slice for ${marker} misses the marker`).toContain(marker);
    return tag;
}

describe('unified button tokens and round base', () => {
    const css = read('src/assets/css/app.css');

    it('single-sources the shared button values and consumes them', () => {
        const start = css.indexOf('UNIFIED BUTTONS');
        expect(start, 'missing UNIFIED BUTTONS section').toBeGreaterThan(-1);
        const block = css.slice(start, css.indexOf('}', start) + 1);
        expect(block).toContain('--uff-btn-bg: #ffffff');
        expect(block).toContain('--uff-btn-fg: #1a1a1a');
        expect(block).toContain('--uff-btn-border: 1px solid #ffffff');
        expect(block).toMatch(/--uff-btn-shadow:\s*0 10px 25px rgba\(0, 0, 0, 0\.2\)/);
        // The tokens must be consumed, not just defined.
        for (const token of ['var(--uff-btn-bg)', 'var(--uff-btn-fg)', 'var(--uff-btn-border)', 'var(--uff-btn-shadow)']) {
            const first = css.indexOf(token);
            expect(first, `unused ${token}`).toBeGreaterThan(-1);
            expect(css.indexOf(token, first + 1), `used only once: ${token}`).toBeGreaterThan(-1);
        }
    });

    it('keeps round buttons borderless by default in the shared token style', () => {
        const shared = cssBlock(css, '.call-btn,\n.call-icon {');
        expect(shared).toContain('border-radius: 50% !important');
        expect(shared).toContain('border: none !important');
        const btn = cssBlock(css, '.call-btn {');
        expect(btn).toContain('background-color: var(--uff-btn-bg) !important');
        expect(btn).toContain('color: var(--uff-btn-fg) !important');
        expect(btn).toContain('box-shadow: var(--uff-btn-shadow)');
    });

    it('gives mode icons the same token style without a border', () => {
        // The standalone rule (not the shared `.call-btn, .call-icon` block):
        // anchor on its unique first declaration.
        const icon = cssBlock(css, '.call-icon {\n    background-color: var(--uff-btn-bg) !important;');
        expect(icon).toContain('color: var(--uff-btn-fg) !important');
        expect(icon).toContain('box-shadow: var(--uff-btn-shadow) !important');
        expect(icon).not.toContain('transparent');
    });

    it('reserves the overlay border for the row-primary marker', () => {
        const marker = cssBlock(css, '.btn-row-primary {');
        expect(marker).toContain('border: var(--uff-btn-border)');
    });
});

describe('rectangular CTAs carry the overlay border', () => {
    const css = read('src/assets/css/app.css');

    it('paints solid theme buttons from the tokens', () => {
        for (const selector of ['.btn-primary {', '.btn-secondary {', '.btn-success {']) {
            const block = cssBlock(css, selector);
            expect(block).toContain('--bs-btn-bg: var(--uff-btn-bg)');
            expect(block).toContain('--bs-btn-color: var(--uff-btn-fg)');
            expect(block).toContain('--bs-btn-border-color: var(--uff-btn-bg)');
            expect(block).toContain('box-shadow: var(--uff-btn-shadow)');
        }
    });

    it('keeps the overlay reference button token-styled with rounded corners', () => {
        const btn = cssBlock(css, '.branch-choice-btn {');
        expect(btn).toContain('background: var(--uff-btn-bg)');
        expect(btn).toContain('border: var(--uff-btn-border)');
        expect(btn).toContain('color: var(--uff-btn-fg)');
        expect(btn).toContain('border-radius: 8px');
        expect(btn).toContain('box-shadow: var(--uff-btn-shadow)');
        const hover = cssBlock(css, '.branch-choice-btn:hover');
        expect(hover).toContain('background: var(--uff-btn-bg)');
        expect(hover).toContain('color: var(--uff-btn-fg)');
    });

    it('borders the single-button round actions from the tokens', () => {
        const submit = cssBlock(css, '#answer-submit-button {');
        expect(submit).toContain('background-color: var(--uff-btn-bg) !important');
        expect(submit).toContain('border: var(--uff-btn-border) !important');
        expect(submit).toContain('border-radius: 50% !important');
        const incoming = cssBlock(css, '.incoming-video-btn {');
        expect(incoming).toContain('background-color: var(--uff-btn-bg)');
        expect(incoming).toContain('border: var(--uff-btn-border)');
        expect(incoming).toContain('color: var(--uff-btn-fg)');
        expect(incoming).toContain('border-radius: 50%');
        expect(incoming).toContain('box-shadow: var(--uff-btn-shadow)');
    });
});

describe('homepage buttons follow the single-or-primary border rule', () => {
    const css = read('src/components/homescreen/home-landing.css');

    it('borders the single-call actions from the tokens', () => {
        const primary = cssBlock(css, '.uff-home-bs .btn-uff-primary {');
        expect(primary).toContain('background-color: var(--uff-btn-bg)');
        expect(primary).toContain('border: var(--uff-btn-border)');
        expect(primary).toContain('color: var(--uff-btn-fg)');
        expect(primary).toContain('border-radius: 8px');
        const topbar = cssBlock(css, '.uff-home-bs .btn-uff-topbar {');
        expect(topbar).toContain('background-color: var(--uff-btn-bg)');
        expect(topbar).toContain('border: var(--uff-btn-border)');
        const play = cssBlock(css, '.uff-carousel-play {');
        expect(play).toContain('background: var(--uff-btn-bg)');
        expect(play).toContain('border: var(--uff-btn-border)');
        expect(play).toContain('border-radius: 50%');
    });

    it('keeps the equal-pair carousel nav borderless in the shared token style', () => {
        const nav = cssBlock(css, '.uff-carousel-nav {');
        expect(nav).toContain('background: var(--uff-btn-bg)');
        expect(nav).toContain('color: var(--uff-btn-fg)');
        expect(nav).toContain('border-radius: 50%');
        expect(nav).toContain('border: none');
        expect(nav).not.toContain('var(--uff-btn-border)');
        expect(nav).not.toContain('rgba(11, 26, 42');
    });
});

const MARKED = [
    ['src/components/widgets/ViewAndContinueButtons.jsx', 'id="continueBtn"'],
    ['src/components/widgets/IntroChoices.jsx', 'id="continueButton"'],
    ['src/components/widgets/SuccessButtons.jsx', 'id="processBtn"'],
    ['src/components/widgets/SuccessButtons.jsx', 'id="createVideoButton"'],
    ['src/components/widgets/ResponseDecisionButtons.jsx', 'id="responseAnswerBtn"'],
    ['src/components/widgets/ResponseDecisionButtons.jsx', 'id="responseTxtBtn"'],
    ['src/components/widgets/MicrophoneToggle.web.jsx', 'id="micBtn"'],
    ['src/components/widgets/MicrophoneToggle.web.jsx', 'id="txtBtn"'],
    ['src/components/widgets/DecisionButtons.jsx', 'id="micBtn"'],
    ['src/components/widgets/DecisionButtons.jsx', 'id="txtBtn"'],
    ['src/components/LessonContainer.jsx', 'phaseData?.onAccept'],
    ['src/components/widgets/TutorialModal.jsx', 'marginTop: 8'],
];

const UNMARKED = [
    ['src/components/widgets/ViewAndContinueButtons.jsx', 'id="replayBtn"'],
    ['src/components/widgets/ViewAndContinueButtons.jsx', 'id="tutorialBtn"'],
    ['src/components/widgets/BranchChoiceButtons.jsx', 'id="branchReplayBtn"'],
    ['src/components/widgets/BranchChoiceButtons.jsx', 'id="branchTutorialBtn"'],
    ['src/components/widgets/ResponseDecisionButtons.jsx', 'id="responseReplayBtn"'],
    ['src/components/widgets/ResponseDecisionButtons.jsx', 'id="responseTutorialBtn"'],
    ['src/components/widgets/IntroChoices.jsx', 'id="audioOnlyButton"'],
    ['src/components/widgets/IntroChoices.jsx', 'id="textOnlyButton"'],
    ['src/components/widgets/DecisionButtons.jsx', 'id="earBtn"'],
    ['src/components/widgets/SuccessButtons.jsx', 'id="repeatButtonSuccess"'],
    ['src/components/widgets/SuccessButtons.jsx', 'id="continueButtonSuccess"'],
    ['src/components/LessonContainer.jsx', 'phaseData?.onReject'],
];

describe('round primaries are marked, secondaries are not', () => {
    it.each(MARKED)('marks %s :: %s', (file, marker) => {
        expect(buttonTag(read(file), marker)).toContain('btn-row-primary');
    });

    it.each(UNMARKED)('leaves %s :: %s borderless', (file, marker) => {
        expect(buttonTag(read(file), marker)).not.toContain('btn-row-primary');
    });
});

describe('inline CTA styles match the unified bordered treatment', () => {
    it('styles the home continue button from the tokens', () => {
        const src = read('src/components/homescreen/HomeScreen.jsx');
        const start = src.indexOf('const continueBtnStyle');
        expect(start, 'missing continueBtnStyle').toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('};', start) + 2);
        expect(block).toContain("background: 'var(--uff-btn-bg)'");
        expect(block).toContain("color: 'var(--uff-btn-fg)'");
        expect(block).toContain("border: 'var(--uff-btn-border)'");
        expect(block).toContain("borderRadius: '8px'");
        expect(block).not.toContain('brandGradient');
    });

    it('styles profile primary buttons from the tokens', () => {
        const src = read('src/components/profile/UserProfile.jsx');
        const start = src.indexOf('const btnPrimaryStyle');
        expect(start, 'missing btnPrimaryStyle').toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('};', start) + 2);
        expect(block).toContain("backgroundColor: 'var(--uff-btn-bg)'");
        expect(block).toContain("border: 'var(--uff-btn-border)'");
        expect(block).not.toContain('#007bff');
    });
});
