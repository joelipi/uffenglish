// Guards for the 3-2-1 pre-roll overlay (story 072 follow-up).
//
// The countdown is a pre-roll: while a number is on screen the localized
// mic + "SPEAK." overlay must be held back, and it must reappear the moment
// the countdown clears. There is deliberately NO mic emoji in the countdown —
// MicStatusText already renders a localized `bi-mic` icon + `status_speak`
// copy in all five locales, so a second icon would duplicate it and would
// not be localized.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREVIEW = readFileSync(resolve(process.cwd(), 'src/components/widgets/WebcamPreview.jsx'), 'utf8');
const MIC = readFileSync(resolve(process.cwd(), 'src/components/widgets/MicStatusText.jsx'), 'utf8');
const ORCH = readFileSync(resolve(process.cwd(), 'src/modules/speech/speech-orchestrator.js'), 'utf8');
const STORE = readFileSync(resolve(process.cwd(), 'src/modules/store/store.js'), 'utf8');

describe('recording countdown overlay', () => {
    it('renders only the countdown number — no mic emoji or icon', () => {
        const start = PREVIEW.indexOf('{recordingCountdown !== null && (');
        expect(start).toBeGreaterThan(-1);
        // Slice the overlay block, bounded at the component's closing tag so a
        // later block cannot satisfy the assertion.
        const overlay = PREVIEW.slice(start, PREVIEW.indexOf('</div>\n            )}', start));
        expect(overlay).toContain('{recordingCountdown}');
        // No emoji, and no bootstrap icon either — the localized one is in
        // MicStatusText and must not be duplicated here.
        expect(overlay).not.toMatch(/[🎤🎙]/u);
        expect(overlay).not.toMatch(/bi-mic/);
    });

    it('overlays on the webcam preview wrapper', () => {
        expect(PREVIEW).toMatch(/id="pip-wrapper"/);
        expect(PREVIEW).toMatch(/data-testid="recording-countdown-overlay"/);
    });

    it('holds the localized speak overlay back while counting', () => {
        // MicStatusText subscribes to the countdown and bails before rendering.
        expect(MIC).toMatch(/recordingCountdown/);
        const sub = MIC.indexOf('const recordingCountdown = useStore');
        const bail = MIC.indexOf('if (recordingCountdown !== null) return null;');
        expect(sub).toBeGreaterThan(-1);
        expect(bail).toBeGreaterThan(sub);
        // And the bail must precede the systemMessage branch it suppresses.
        expect(bail).toBeLessThan(MIC.indexOf('if (systemMessage) {'));
    });

    it('the suppressed overlay is the localized one, not a new string', () => {
        // The held-back overlay is `speak-now`, which MicStatusText renders
        // with the already-localized status_speak copy.
        expect(MIC).toMatch(/case 'speak-now':/);
        expect(MIC).toMatch(/bi bi-mic/);
        const strings = readFileSync(resolve(process.cwd(), 'src/data/strings.js'), 'utf8');
        const en = strings.indexOf("'status_speak'");
        expect(en).toBeGreaterThan(-1);
        const block = strings.slice(en, strings.indexOf('},', en));
        for (const lang of ['en', 'es', 'fr', 'hi', 'bn']) {
            expect(block).toMatch(new RegExp(`${lang}:`));
        }
    });

    it('orchestrator runs exactly 3, 2, 1 and clears to null', () => {
        expect(ORCH).toMatch(/for \(const n of \[3, 2, 1\]\)/);
        expect(ORCH).toMatch(/setRecordingCountdown\(n\)/);
        expect(ORCH).toMatch(/setRecordingCountdown\(null\)/);
        // The removed phase must not come back.
        expect(ORCH).not.toMatch(/setRecordingCountdown\('mic'\)/);
    });

    it('store state documents the real value set', () => {
        expect(STORE).toMatch(/recordingCountdown: null,\s*\/\/ null \| 3 \| 2 \| 1/);
        expect(STORE).toMatch(/setRecordingCountdown: \(val\) => set\(\{ recordingCountdown: val \}\)/);
    });
});