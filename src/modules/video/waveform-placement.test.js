// The transcribing waveform must not sit over the take's play control
// (stories/094).
//
// The recorded take is visible while transcription runs, and its play control
// is in the middle of the 9:16 frame. The waveform used to be centred there at
// z-index 20 (above the player's 10), so it covered the control exactly when the
// learner needed to tap it. It is anchored above the bottom control row now.
//
// Raw CSS read: layout contract, invisible to unit tests, so pin the shape.
// Proven failable by restoring `top: 50%` (goes red) and reverting (green).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const css = readFileSync(path.join(ROOT, 'src/assets/css/app.css'), 'utf8');

function rule(selector) {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`selector missing: ${selector}`);
    const end = css.indexOf('}', start);
    return css.slice(start, end);
}

describe('the waveform does not cover the play control', () => {
    const waveform = rule('.waveform-container');

    it('is not vertically centred in the frame', () => {
        expect(waveform).not.toMatch(/top:\s*50%/);
        expect(waveform).toMatch(/bottom:/);
        expect(waveform).toMatch(/top:\s*auto/);
    });

    it('still cannot swallow a tap', () => {
        expect(waveform).toContain('pointer-events: none');
    });

    it('keeps its size and stacking so the label stays readable', () => {
        expect(waveform).toContain('z-index: 20');
        expect(waveform).toContain('max-width: 500px');
    });
});
