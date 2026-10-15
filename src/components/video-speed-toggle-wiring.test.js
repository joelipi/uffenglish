// Static guards for the snail video-speed toggle wiring.
// Every non-interactive lesson video surface renders VideoSpeedToggle as an
// overlay (snail icon + rate label, cycling 1x -> 0.8x -> 0.6x -> 1x) while
// InteractiveVideoPlayer keeps its scoring-coupled playbackRate untouched.
// All assertions read RAW source (never comment-stripped).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const logic = read('src/modules/video/video-speed-logic.js');
const toggle = read('src/components/VideoSpeedToggle.jsx');
const simple = read('src/components/SimpleVideoPlayer.web.jsx');
const interactive = read('src/components/InteractiveVideoPlayer.web.jsx');
const tutorial = read('src/components/widgets/TutorialModal.jsx');
const playback = read('src/components/PlaybackVideo.jsx');
const success = read('src/components/widgets/SuccessVideo.jsx');
const css = read('src/assets/css/app.css');

function cssBlock(selector) {
    const start = css.indexOf(`\n${selector}`);
    expect(start, `app.css is missing the ${selector} rule`).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    expect(end, `${selector} has no closing brace`).toBeGreaterThan(start);
    return css.slice(start, end + 1);
}

describe('speed logic module owns the cycle', () => {
    it('publishes the 1 -> 0.8 -> 0.6 steps and the toggle test id', () => {
        expect(logic).toContain('VIDEO_SPEED_STEPS');
        expect(logic).toContain('[1, 0.8, 0.6]');
        expect(logic).toContain('VIDEO_SPEED_TOGGLE_TESTID');
        expect(logic).toContain('export function nextVideoSpeed(');
        expect(logic).toContain('export function buildVideoSpeedToggleView(');
        expect(logic).toContain('export function applyVideoSpeed(');
    });
});

describe('VideoSpeedToggle is render-only with a snail icon', () => {
    it('derives everything from the logic module and renders snail + label', () => {
        expect(toggle).toContain("from '../modules/video/video-speed-logic.js'");
        expect(toggle).toContain('buildVideoSpeedToggleView(');
        expect(toggle).toContain('data-testid={view.testId}');
        expect(toggle).toContain('video-speed-toggle-snail');
        expect(toggle).toContain('🐌');
        expect(toggle).toContain('{view.label}');
    });

    it('holds no rate math or step literals itself', () => {
        expect(toggle).not.toContain('0.8');
        expect(toggle).not.toContain('0.6');
        expect(toggle).not.toContain('playbackRate =');
    });

    it('stops propagation so the overlay never toggles play/pause', () => {
        expect(toggle).toContain('e.stopPropagation()');
    });
});

describe('non-interactive video surfaces render the toggle', () => {
    it('SimpleVideoPlayer imports the toggle and the logic, and renders it', () => {
        expect(simple).toContain("from './VideoSpeedToggle.jsx'");
        expect(simple).toContain("from '../modules/video/video-speed-logic.js'");
        expect(simple).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />');
    });

    it('SimpleVideoPlayer resets the rate per clip and syncs it to the element', () => {
        expect(simple).toContain('const [playbackRate, setPlaybackRate] = useState(1);');
        expect(simple).toContain('applyVideoSpeed(videoRef.current, playbackRate)');
        expect(simple).toContain('setPlaybackRate(1);');
        expect(simple).toContain('nextVideoSpeed(playbackRate)');
    });

    it('TutorialModal renders the toggle over its portrait video', () => {
        expect(tutorial).toContain("from '../VideoSpeedToggle.jsx'");
        expect(tutorial).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={setPlaybackRate} />');
        expect(tutorial).toContain('applyVideoSpeed(videoRef.current, playbackRate)');
    });

    it('PlaybackVideo renders the toggle', () => {
        expect(playback).toContain("from './VideoSpeedToggle.jsx'");
        expect(playback).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={setPlaybackRate} />');
        expect(playback).toContain('applyVideoSpeed(videoRef.current, playbackRate)');
    });

    it('SuccessVideo renders the toggle', () => {
        expect(success).toContain("from '../VideoSpeedToggle.jsx'");
        expect(success).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={setPlaybackRate} />');
        expect(success).toContain('applyVideoSpeed(videoRef.current, playbackRate)');
    });
});

describe('InteractiveVideoPlayer is excluded', () => {
    it('never imports or renders the snail toggle', () => {
        expect(interactive).not.toContain('VideoSpeedToggle');
        expect(interactive).not.toContain('video-speed-toggle');
        expect(interactive).not.toContain('nextVideoSpeed');
    });
});

describe('app.css carries the toggle overlay stylesheet', () => {
    it('positions the pill top-right above the video but below decision layers', () => {
        const block = cssBlock('.video-speed-toggle {');
        expect(block).toContain('position: absolute');
        expect(block).toContain('top:');
        expect(block).toContain('right: 12px');
        expect(block).toContain('z-index: 30');
        expect(block).toContain('border-radius: 9999px');
    });

    it('highlights the slowed state', () => {
        const block = cssBlock('.video-speed-toggle-active {');
        expect(block).toContain('background:');
    });
});
