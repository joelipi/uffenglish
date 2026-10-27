// Guards for the review countdown being OFF by default
// (review-countdown-logic.js).
//
// The transcript review used to auto-accept after 7 seconds. The code is kept —
// flipping `REVIEW_COUNTDOWN_ENABLED` restores it — but while it is off there
// must be no timer on screen and nothing that accepts on the learner's behalf.
//
// Guard discipline (docs/learnings.md): every slice runs from a real start marker
// to the NEXT real marker (never EOF), sequenced calls assert index order, and
// absence assertions run on comment-stripped source so the guard's own prose
// cannot satisfy them. Slices are taken INSIDE each test, so a missing marker
// fails that named guard instead of erroring the whole file ("no tests").
//
// Fail-proof note: proven able to fail by (a) flipping the switch to `true`,
// (b) restoring `let timeLeft = 7;` in the orchestrator, (c) deleting the
// `if (timeLeft === null) { … return; }` gate, and (d) un-gating the overlay's
// "Time remaining" line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relative) {
    return readFileSync(path.join(ROOT, relative), 'utf8');
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sliceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`start token missing: ${startToken}`);
    const end = source.indexOf(endToken, start + startToken.length);
    if (end === -1) throw new Error(`end token missing: ${endToken}`);
    return source.slice(start, end);
}

const LOGIC = 'src/modules/lesson/review-countdown-logic.js';
const ORCHESTRATOR = 'src/modules/speech/speech-orchestrator.js';
const OVERLAY = 'src/components/widgets/WhisperReview.jsx';

/** The review half of the orchestrator, bounded at the next top-level function. */
function reviewTail() {
    return sliceBetween(
        read(ORCHESTRATOR),
        "console.warn('[PT] CALLING onReviewStart'",
        'async function toggleSpeechRecognition'
    );
}

describe('the countdown is switched off in the module that owns it', () => {
    it('ships disabled', () => {
        expect(read(LOGIC)).toMatch(/export const REVIEW_COUNTDOWN_ENABLED = false;/);
    });

    it('documents the switch as deliberate, not dead code', () => {
        const logic = read(LOGIC);
        expect(logic).toContain('off by default');
        expect(logic).toContain('export function resolveReviewCountdownStart(');
        expect(logic).toContain('export function shouldAutoAcceptReview(');
        expect(logic).toContain('export function shouldShowReviewCountdown(');
    });
});

describe('the orchestrator asks the module instead of hard-coding 7 seconds', () => {
    it('takes the starting value from the resolver', () => {
        const start = sliceBetween(
            read(ORCHESTRATOR),
            'let timeLeft = resolveReviewCountdownStart();',
            'const restartTakeAfterReject'
        );
        expect(start).toContain('resolveReviewCountdownStart()');
        // Comment-stripped: a literal 7 means the switch was bypassed.
        expect(stripComments(start)).not.toMatch(/timeLeft\s*=\s*7\b/);
    });

    it('stops the ticker from the accept path, before it answers', () => {
        const accept = sliceBetween(
            read(ORCHESTRATOR),
            'const acceptTranscript = () => {',
            'const restartTakeAfterReject'
        );
        expect(accept).toContain('stopReviewCountdown();');
        expect(accept.indexOf('stopReviewCountdown();')).toBeLessThan(accept.indexOf('handleAnswer('));
    });

    it('stops the ticker from the reject path, before it clears the take', () => {
        const reject = sliceBetween(
            read(ORCHESTRATOR),
            'const rejectTranscript = () => {',
            "console.warn('[PT] CALLING onReviewStart'"
        );
        expect(reject).toContain('stopReviewCountdown();');
        expect(reject.indexOf('stopReviewCountdown();')).toBeLessThan(reject.indexOf('clearPlaybackBlob()'));
    });
});

describe('nothing ticks or accepts while the countdown is off', () => {
    it('returns before the interval when there is no countdown', () => {
        const tail = reviewTail();
        expect(tail).toContain('if (timeLeft === null) {');
        // The interval must come AFTER that gate, or a disabled countdown still
        // runs and still auto-accepts.
        expect(tail.indexOf('if (timeLeft === null) {'))
            .toBeLessThan(tail.indexOf('setInterval('));
    });

    it('lets the module decide the auto-accept, not a bare comparison', () => {
        const tail = reviewTail();
        expect(tail).toContain('shouldAutoAcceptReview({ timeLeft })');
        // Comment-stripped and scoped: an inline `timeLeft <= 0` would bypass the
        // switch (that is exactly the pre-switch code).
        expect(stripComments(tail)).not.toContain('timeLeft <= 0');
    });

    it('still hands the review its accept and reject callbacks', () => {
        expect(reviewTail()).toContain(
            'uiHooks.onReviewStart(displayTranscript, timeLeft, acceptTranscript, rejectTranscript)'
        );
    });
});

describe('the overlay renders a timer only when there is one', () => {
    it('gates the "Time remaining" line behind the module rule', () => {
        const overlay = read(OVERLAY);
        expect(overlay).toContain('shouldShowReviewCountdown(timeLeft)');
        const gated = overlay.slice(overlay.indexOf('{showCountdown && ('));
        expect(gated).toContain('Time remaining: {timeLeft}s');
    });

    it('gates the bar too, and takes its fill from the module', () => {
        const overlay = read(OVERLAY);
        expect(overlay).toContain('reviewCountdownProgress(timeLeft)');
        // The old component divided by the literal 7 here.
        expect(stripComments(overlay)).not.toContain('/ 7');
        // Both the line and the bar sit inside a `showCountdown &&` block.
        expect(overlay.match(/\{showCountdown && \(/g)?.length).toBe(2);
    });

    it('keeps the transcript outside the gate', () => {
        const box = sliceBetween(
            read(OVERLAY),
            '<div className="whisper-review-box',
            '</div>\n        </div>'
        );
        expect(box).toContain('data.transcript');
        // The transcript is unconditional: it is what the learner reads while
        // there is no timer to wait on.
        expect(box).toContain('{`\\"${data.transcript}\\"`}');
    });
});
