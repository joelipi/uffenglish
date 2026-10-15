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
const hook = read('src/hooks/useVideoSpeed.js');
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

    it('logs only from the click handler, never in the render body', () => {
        const renderBody = toggle.slice(toggle.indexOf('function VideoSpeedToggle'), toggle.indexOf('const handleClick'));
        expect(renderBody).not.toContain('console.log');
    });
});

describe('useVideoSpeed owns the shared speed contract', () => {
    it('holds the rate state, the per-clip reset and the element sync', () => {
        expect(hook).toContain("from '../modules/video/video-speed-logic.js'");
        expect(hook).toContain('export function useVideoSpeed(videoRef, resetKey)');
        expect(hook).toContain('const [rate, setRate] = useState(1);');
        expect(hook).toContain('setRate(1);');
        expect(hook).toContain('applyVideoSpeed(videoRef.current, rate)');
        expect(hook).toContain('nextVideoSpeed(rate)');
    });
});

describe('non-interactive video surfaces render the toggle', () => {
    it('SimpleVideoPlayer shares the hook and renders the toggle', () => {
        expect(simple).toContain("from '../hooks/useVideoSpeed.js'");
        expect(simple).toContain('useVideoSpeed(videoRef, config?.videoUrl)');
        expect(simple).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />');
    });

    it('SimpleVideoPlayer holds no speed state, reset or sync of its own', () => {
        expect(simple).not.toContain('const [playbackRate, setPlaybackRate]');
        expect(simple).not.toContain('nextVideoSpeed(playbackRate)');
        expect(simple).not.toContain('applyVideoSpeed(videoRef.current');
    });

    it('TutorialModal renders the toggle over its portrait video', () => {
        expect(tutorial).toContain("from '../../hooks/useVideoSpeed.js'");
        expect(tutorial).toContain('useVideoSpeed(videoRef, view.videoUrl)');
        expect(tutorial).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />');
    });

    it('PlaybackVideo renders the toggle', () => {
        expect(playback).toContain("from '../hooks/useVideoSpeed.js'");
        expect(playback).toContain('useVideoSpeed(videoRef, blob)');
        expect(playback).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />');
    });

    it('SuccessVideo renders the toggle', () => {
        expect(success).toContain("from '../../hooks/useVideoSpeed.js'");
        expect(success).toContain('useVideoSpeed(videoRef, blob)');
        expect(success).toContain('<VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />');
    });
});

describe('InteractiveVideoPlayer is excluded', () => {
    it('never imports or renders the snail toggle or the shared hook', () => {
        expect(interactive).not.toContain('VideoSpeedToggle');
        expect(interactive).not.toContain('video-speed-toggle');
        expect(interactive).not.toContain('nextVideoSpeed');
        expect(interactive).not.toContain('useVideoSpeed');
    });
});

describe('app.css carries the toggle overlay stylesheet', () => {
    it('positions the pill below the lesson header so it stays visible and tappable', () => {
        const block = cssBlock('.video-speed-toggle {');
        expect(block).toContain('position: absolute');
        // 20% clears the stats cluster (~52px, z-35) and the header blur
        // (up to 18.5% on branching steps, z-34), both painted above z-30.
        expect(block).toContain('top: calc(20%');
        expect(block).toContain('right: 12px');
        expect(block).toContain('z-index: 30');
        expect(block).toContain('border-radius: 9999px');
    });

    it('highlights the slowed state', () => {
        const block = cssBlock('.video-speed-toggle-active {');
        expect(block).toContain('background:');
    });
});
