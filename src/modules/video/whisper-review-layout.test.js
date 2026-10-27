// The transcript box must not sit over the recorded take's play control
// (stories/094).
//
// The take auto-plays, but when iOS refuses, the learner's only way in is the
// play control in the middle of the 9:16 frame. The review overlay used to be a
// centred flex column, so its opaque box covered exactly that control — the
// learner could not see (and therefore could not tap) the one thing that would
// start the clip. The overlay is anchored to the top instead, and keeps
// `pointerEvents: none` so taps still reach the video underneath it.
//
// Raw source read: this is a layout contract, and the failure mode is visible
// only on a device, so pin the shape. Proven failable by restoring
// `justify-content-center` (goes red) and reverting (green).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const raw = readFileSync(path.join(ROOT, 'src/components/widgets/WhisperReview.jsx'), 'utf8');

function sliceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`start token missing: ${startToken}`);
    const end = source.indexOf(endToken, start + startToken.length);
    if (end === -1) throw new Error(`end token missing: ${endToken}`);
    return source.slice(start, end);
}

const overlay = sliceBetween(raw, 'return (', '<div className="whisper-review-box');

describe('the transcript overlay leaves the centre of the frame free', () => {
    it('is not vertically centred (that is where the play control sits)', () => {
        expect(overlay).not.toContain('justify-content-center');
        expect(overlay).toContain("justifyContent: 'flex-start'");
    });

    it('never uses an !important spacing utility for its own top offset', () => {
        // app.css defines .p-* with !important, so a `p-*`/`pt-*` class on the
        // overlay silently beats the measured paddingTop and pins the box to
        // 16px — exactly the "overlapping the progress bar" report.
        expect(overlay).not.toMatch(/className="[^"]*\bp[ txyb]?-?\d/);
        expect(overlay).toContain('paddingLeft: 12');
        expect(overlay).toContain('paddingTop: resolveTranscriptTopOffset(topOffsetPx)');
    });

    it('starts flush with the measured bottom of the top overlay', () => {
        expect(overlay).toContain('position-absolute top-0 start-0 w-100 h-100');
        // No fixed top padding: the bar's height varies by step and language.
        expect(overlay).not.toContain('pt-4');
        expect(overlay).toContain('paddingTop: resolveTranscriptTopOffset(topOffsetPx)');
        expect(raw).toContain('resolveTranscriptTopOffset');
    });

    it('never swallows the tap meant for the video', () => {
        expect(overlay).toContain("pointerEvents: 'none'");
    });

    it('still renders the transcript, and the countdown only when it is on', () => {
        expect(raw).toContain('Time remaining: {timeLeft}s');
        expect(raw).toContain('data.transcript');
        // The countdown is off by default (review-countdown-logic.js). The
        // markup is pinned anyway, so switching it back on needs no UI work.
        expect(raw).toContain('shouldShowReviewCountdown(timeLeft)');
    });
});
