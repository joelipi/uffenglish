// src/modules/speech/speech-pipeline-selection.test.js
//
// Every user runs the light Transformers.js tiny.en pipeline — PWA mode
// included. This guards that decision *and* the promise attached to it: when the
// heavy pipeline comes back it must be gated on device capability, not on PWA
// mode.
//
// Why it matters: the Sherpa-ONNX path fetches a ~110 MB package (.wasm + .data,
// the latter ~99 MB) and holds it as WASM memory. Selecting it merely because
// someone installed the PWA meant a weak phone that installed the app was handed
// the one pipeline it cannot survive. See the note at the top of speech.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

const SPEECH = read('src', 'modules', 'speech', 'speech.js');
const SCORING = read('src', 'modules', 'answer', 'scoring.js');
const ORCHESTRATOR = read('src', 'modules', 'speech', 'speech-orchestrator.js');
const PWA_WORKER = read('src', 'workers', 'whisper', 'whisper-worker-web.js');
const LIGHT_WORKER = read('src', 'workers', 'whisper', 'whisper-worker-demo.js');

/** Just createWhisperWorker, so an unrelated Worker elsewhere cannot satisfy this. */
function createWhisperWorkerRegion(source) {
    const start = source.indexOf('function createWhisperWorker(');
    expect(start, 'createWhisperWorker not found').toBeGreaterThan(-1);
    const end = source.indexOf('\n}\n', start);
    expect(end, 'end of createWhisperWorker not found').toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('speech pipeline selection', () => {
    it('builds the light worker unconditionally', () => {
        const region = createWhisperWorkerRegion(SPEECH);
        expect(region).toContain('whisper-worker-demo.js');
        // Assert the heavy worker is absent from the selection itself, not merely
        // that a ternary mentions both arms.
        expect(region).not.toContain('whisper-worker-web.js');
    });

    it('does not branch on PWA mode anywhere in speech.js', () => {
        // A leftover `isPWAMode ? ... : ...` would reintroduce the split.
        expect(SPEECH).not.toContain('getIsPWAMode');
        expect(SPEECH).not.toContain('isPWAMode');
    });

    it('states that the heavy pipeline returns behind a device-capability gate', () => {
        // The decision is deliberately temporary; the comment is the deliverable
        // that makes it safe to revisit. Without it the next person re-adds the
        // branch on PWA mode.
        expect(SPEECH).toMatch(/TEMPORARY/);
        expect(SPEECH).toMatch(/device-capability gate|deviceMemory/);
        // Tolerate the line-wrap and `// ` continuation markers between the two
        // words, so editing the comment's layout cannot silently disarm this.
        expect(SPEECH).toMatch(/reintroduce the[\s\S]{0,80}?heavy pipeline/i);
    });

    it('keeps the heavy worker on disk for that gate to select', () => {
        expect(PWA_WORKER).toContain('sherpa-onnx-wasm-main-vad-asr.wasm');
        expect(PWA_WORKER).toContain('sherpa-onnx-wasm-main-vad-asr.data');
    });
});

describe('flow scoring is untouched by the pipeline switch', () => {
    it('still branches on PWA mode, because its pause count comes from elsewhere', () => {
        // `pauseCount` is produced APP-SIDE by the shared orchestrator
        // (speech-orchestrator.js calls Core.trimSilenceWithPadding and forwards
        // extractionResult.pauseCount), so it is real for BOTH pipelines. It has
        // nothing to do with which worker speech.js constructs.
        //
        // The worker's own `pauseCount: 0` in whisper-worker-demo.js lives in the
        // `vad_result` branch, and the only sender of `vad_analyze`
        // (analyzeAudioBufferWithVAD) is never called — so it is dead and must not
        // be read as "the light pipeline reports zero pauses".
        expect(SCORING).toContain('const isPWAMode = appStore.getState().isPWAMode;');
        expect(SCORING).toContain('flow = Math.round((wpmScore + pausesScore + hesitationScore) / 3);');
        expect(SCORING).toContain('flow = Math.round((wpmScore + hesitationScore) / 2);');
    });

    it('the app-side pause producer is the orchestrator, not a worker', () => {
        // Guards the reasoning above against being "simplified" later on the
        // mistaken belief that pauses only exist in the heavy pipeline.
        expect(ORCHESTRATOR).toContain('Core.trimSilenceWithPadding');
        expect(ORCHESTRATOR).toMatch(/pauseCount:\s*extractionResult\.pauseCount/);
        // And the worker-side branch that would carry a literal 0 stays unreached.
        // Anchored to the `vad_result` branch, not asserted as a bare presence:
        // a whole-file match would still pass if the literal were moved into a
        // LIVE branch, which is exactly when the premise above stops being true.
        const vadAt = LIGHT_WORKER.indexOf("type: 'vad_result'");
        expect(vadAt, 'vad_result branch not found').toBeGreaterThan(-1);
        const vadBranch = LIGHT_WORKER.slice(vadAt, LIGHT_WORKER.indexOf('\n};', vadAt));
        expect(vadBranch).toMatch(/pauseCount:\s*0/);
    });
});
