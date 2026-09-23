import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PATH = path.join(__dirname, 'video-processor.web.js');

describe('video-processor.web.js recap wiring guard', () => {
    const source = readFileSync(WEB_PATH, 'utf8');

    it('no longer references the retired webcamOnly flag', () => {
        expect(source).not.toMatch(/\bwebcamOnly\b/);
    });

    it('uses isShareCtaEnabled for the shareCta gate', () => {
        expect(source).toMatch(/isShareCtaEnabled/);
    });

    it('passes overlayVariant through executeRenderLoop and into resolveOverlayElements', () => {
        expect(source).toMatch(/overlayVariant/);
        expect(source).toMatch(/resolveOverlayElements\(\{\s*variant: overlayVariant/);
    });

    it('keeps renderStepToBlob overlay-free (silent only)', () => {
        const start = source.indexOf('async function renderStepToBlob');
        const end = source.indexOf('export async function exportSegmentsToR2');
        const renderStepBlob = source.slice(start, end);
        expect(renderStepBlob).toMatch(/\{ silent: true \}/);
        expect(renderStepBlob).not.toMatch(/overlayVariant/);
        expect(renderStepBlob).not.toMatch(/shareCta/);
    });

    it('uses the shared dropped-step helpers and revokes clip object URLs', () => {
        // The "first renderable step" rule lives in video-processor-logic.js
        // (unit-tested); the web layer must consume the helpers, not re-inline it.
        expect(source).toMatch(/isDroppedStep/);
        expect(source).toMatch(/markFirstRenderable/);
        expect(source).toMatch(/URL\.revokeObjectURL/);
    });

    it('distinguishes a never-loaded clip from one that is still buffering', () => {
        // A timeout must not drop a healthy but slow-to-play clip, and a late
        // metadata handler must not mutate the next step's element.
        expect(source).toMatch(/metadataLoaded/);
        expect(source).toMatch(/step\.playFatal/);
        expect(source).toMatch(/const stale = \(\) => plan\[stepIndex\] !== step/);
    });

    it('mutes the element before play and pre-decodes friend audio on Safari', () => {
        // Muting after play lets the element's audio overlap the decoded buffer
        // (echo) on iPad, so assert the ORDER: the mute assignment must precede
        // the first await video.play().
        expect(source).toMatch(/video\.muted = useDecodedAudio;[\s\S]{0,120}?await video\.play\(\)/);
        expect(source).toMatch(/detectSafari/);
        expect(source).toMatch(/Remote clip audio pre-decode/);
    });

    it('handles non-finite MediaRecorder blob durations (iPad WebM freeze)', () => {
        // iOS records WebM, whose blobs report duration Infinity; without this
        // the advance check never fires and the segment freezes.
        expect(source).toMatch(/forceVideoDuration/);
        expect(source).toMatch(/step\.resolvingDuration/);
        expect(source).toMatch(/Number\.isFinite\(rawDuration\)/);
    });

    it('never nulls shared plan blobs (would drop clips from the recap/export)', () => {
        // draw() runs every frame and the plan objects are shared with the
        // concurrent R2 export, so nulling remoteBlob/decodedAudio drops clips.
        expect(source).not.toMatch(/step\.remoteBlob = null/);
        expect(source).not.toMatch(/step\.decodedAudio = null;\s*\n\s*step\.remoteBlob/);
    });

    it('rewinds after the duration probe and ignores a stale ended state', () => {
        // forceVideoDuration seeks to the end; without a rewind + an
        // ended-only-after-playback guard the first clip is skipped.
        expect(source).toMatch(/Rewind after duration probe failed/);
        expect(source).toMatch(/const endedNaturally = stepStartedPlaying && video\.ended/);
    });

    it('draws the translated subtitle in the normal face, never italic', () => {
        // italic triggers synthetic oblique in fonts without a true italic
        // face, which shifts complex-script ink off the centre. The
        // translation stays distinct via its smaller size.
        expect(source).not.toMatch(/italic/i);
        expect(source.match(/\$\{trFontSize\}px "Plus Jakarta Sans", sans-serif/g)).toHaveLength(3);
        expect(source).toMatch(/bold \$\{enFontSize\}px "Plus Jakarta Sans", sans-serif/);
    });
});
