// Guards for the capture release around the playback of a recorded take
// (stories/075-fix-android-silent-video-start).
//
// The Android-only "the clip starts silent / very quiet" symptom has one
// app-level cause the app CAN control: on Android an open capture holds the
// device in a communication audio mode, and the media route then ducks (or
// mutes) whatever plays next. The capture used to be released only AFTER the
// clip had been handed to the player — and after the thumbnail generation and
// the database write, which together cover the first second of the clip.
//
// These are source-shape guards because speech.web.js reads browser globals at
// module load and cannot be imported in jsdom. The rules themselves live in the
// pure module capture-release-logic.js and are tested behaviourally there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const speechRaw = readFileSync(path.join(ROOT, 'src/modules/speech/speech.web.js'), 'utf8');

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

// The whole stop function, bounded at the NEXT top-level declaration (never
// EOF), so a later function cannot satisfy the assertions.
const stopBody = sliceBetween(
    speechRaw,
    'export function stopSpeechCamRecording(',
    'export async function startLocalAudioTap('
);

describe('the capture is closed before the recorded take is handed to the player', () => {
    it('imports the pure release rules', () => {
        expect(speechRaw).toContain("from './capture-release-logic.js';");
    });

    it('releases the capture, waits for the audio route, and only then hands over the blob', () => {
        const release = stopBody.indexOf('releaseCapture();');
        const settle = stopBody.indexOf('await waitForAudioRouteSettle();');
        const handover = stopBody.indexOf('setPlaybackBlob(');

        expect(release).toBeGreaterThan(-1);
        expect(settle).toBeGreaterThan(-1);
        expect(handover).toBeGreaterThan(-1);

        // The order is the whole point: the capture must be closed BEFORE the
        // clip reaches the player, and the audio route must be given a moment
        // to hand back from the communication mode before the clip starts.
        expect(release).toBeLessThan(settle);
        expect(settle).toBeLessThan(handover);
    });

    it('gates the early release on the pure rule, not on an inline condition', () => {
        expect(stopBody).toContain('shouldReleaseCaptureBeforePlayback({ releaseAfterRecording, playback: true })');
    });

    it('the release is idempotent, so the finally block cannot double-release', () => {
        const releaseHelper = sliceBetween(stopBody, 'const releaseCapture = () => {', '\n    };');
        expect(releaseHelper).toContain('if (captureReleased) return;');
        expect(releaseHelper).toContain('captureReleased = true;');
        // The helper must actually stop the tracks, not just clear the store.
        expect(releaseHelper).toContain('setWebcamStream(null)');
        expect(releaseHelper).toContain('safelyStopStream()');
    });

    it('the finally block still closes the capture when the early release did not run', () => {
        // The finally block is the safety net for the desktop warm-up path
        // (keepStreamAlive: true) and for the paths that never reach the
        // hand-over.
        const finallyBlock = sliceBetween(stopBody, '} finally {', '\n                    }');
        expect(finallyBlock).toContain('if (releaseAfterRecording) { releaseCapture(); }');
    });

    it('the never-started abort still closes the capture', () => {
        const elseBranch = sliceBetween(stopBody, '} else {\n            speechCamRecorder = null;', '\n            return Promise.resolve(null);');
        expect(elseBranch).toContain('shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted: false })');
        expect(elseBranch).toContain('releaseCapture();');
    });

    it('does not release the capture before the hand-over when no clip is played', () => {
        // The hand-over branch is guarded by `playback && blob.size > 0`, so a
        // call with playback: false never reaches the release.
        const handoverBlock = sliceBetween(stopBody, 'if (playback && blob.size > 0) {', '\n                        }\n');
        expect(handoverBlock).toContain('shouldReleaseCaptureBeforePlayback');
    });

    it('the store-only clear is not used as the release', () => {
        // `setWebcamStream(null)` alone only clears the STORE's reference; the
        // module-level stream keeps its live tracks, so the capture stays open.
        // The release helper is the ONE place where the pair is allowed.
        const releaseHelper = sliceBetween(stopBody, 'const releaseCapture = () => {', '\n    };');
        const stripped = stripComments(stopBody.split(releaseHelper).join(''));
        expect(stripped).not.toMatch(/setWebcamStream\(null\);\s*safelyStopStream\(\)/);
    });
});

// stories/094: a take that plays as a still frame is diagnosed from the capture
// it recorded and the file it produced, both keyed by the take number — the
// first take and a re-record behave differently on iPadOS.
describe('a take names its capture and its blob', () => {
    it('imports both helpers from the capture module', () => {
        expect(speechRaw).toContain('describeCaptureStream,');
        expect(speechRaw).toContain('describeRecordingBlob,');
    });

    it('numbers the take when the recorder is created and logs its capture', () => {
        const start = sliceBetween(speechRaw, 'speechCamTakeIndex += 1;', 'speechCamRecorder = new MediaRecorder');
        expect(start).toContain('describeCaptureStream(speechCamStream');
        expect(start).toContain('take: speechCamTakeIndex');
        // The counter must advance BEFORE the recorder exists, so the blob log
        // of the same take can name it.
        expect(start.indexOf('speechCamTakeIndex += 1;'))
            .toBeLessThan(start.indexOf('describeCaptureStream('));
    });

    it('logs the recorded blob with the same take number', () => {
        const blobSlice = sliceBetween(
            speechRaw,
            'const blobDiagnostics = describeRecordingBlob(blob',
            "takeDiagnostics.push('blob take '"
        );
        expect(blobSlice).toContain('take: speechCamTakeIndex');
        // The same object goes to the console and to the on-screen panel.
        expect(speechRaw).toContain("console.log('[Recording] take blob', blobDiagnostics);");
        expect(speechRaw).toContain("takeDiagnostics.push('blob take ' + speechCamTakeIndex, blobDiagnostics);");
    });
});
