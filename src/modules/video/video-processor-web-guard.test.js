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
        // the advance check never fires and the segment freezes. The end
        // decision now comes from the pure rule plus a container probe.
        expect(source).toMatch(/forceVideoDuration/);
        expect(source).toMatch(/step\.resolvingDuration/);
        expect(source).toMatch(/probeClipDurationSec/);
        expect(source).toMatch(/step\.mediaDurationSec/);
        expect(source).toMatch(/resolveSegmentBounds/);
    });

    it('wires the container probe and the bounds rule from their modules', () => {
        // The probe comes from the web transcode module; the pure rule from
        // the platform-agnostic logic module.
        expect(source).toMatch(/probeClipDurationSec\s*\}\s*from '\.\/transcode\.js'/);
        expect(source).toMatch(/import \{[^}]*resolveSegmentBounds[^}]*STALL_GRACE_MS[^}]*\} from '\.\/video-processor-logic\.js'/);
        expect(source).toMatch(/fallbackDurationSec: step\.mediaDurationSec/);
        expect(source).toMatch(/await probeClipDurationSec\(step\.blob \|\| step\.remoteBlob\)/);
        // The probe must not be raced against a timeout that resolves null: a
        // slow-but-valid read would otherwise be truncated by the 15 s cap.
        expect(source).not.toMatch(/Promise\.race\(\[\s*probeClipDurationSec/);
        // A stale probe must not leak across steps: it is reset alongside the
        // other per-step playback health fields.
        expect(source).toMatch(/step\.loadFailed = false;\s*step\.playFatal = false;\s*step\.mediaDurationSec = undefined;/);
    });

    it('no longer derives a media length from net speaking time', () => {
        // The old fallback truncated a clip to its net speech duration; the
        // `|| 60` hard cap turned an unresolved duration into a 60 s hang.
        expect(source).not.toMatch(/Number\.isFinite\(rawDuration\)\s*\?\s*rawDuration\s*:\s*\(step\.duration/);
        expect(source).not.toMatch(/step\.duration \|\| 60/);
    });

    it('keeps the stall guard and the text-mode/unresolved-duration holds', () => {
        expect(source).toMatch(/stalledTimeout/);
        expect(source).toMatch(/STALL_GRACE_MS/);
        expect(source).toMatch(/step\.isTextMode \|\| \(step\.type === 'webcam' && !step\.blob\)/);
        expect(source).toMatch(/TEXT_MODE_DURATION_MS/);
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

    it('resolves the recap language guest-first in both process and export', () => {
        // A guest who chose Spanish must get a Spanish recap even when
        // userData.native_language is stale; the precedence is shared with
        // normalizeConfig (single-sourced via resolveConfigLanguage).
        expect(source).toMatch(
            /import \{ resolveConfigLanguage \} from '\.\.\/bilingual\/config-normalizer\.js'/
        );
        // Assert the argument ORDER (guest first, profile second); a swap would
        // silently restore the exact regression this fix prevents.
        const uses = source.match(
            /const userLang = resolveConfigLanguage\(snapshot\.guestNativeLanguage, snapshot\.userData\?\.native_language\)/g
        ) || [];
        expect(uses).toHaveLength(2);
        expect(source).not.toMatch(
            /const userLang = appStore\.getState\(\)\.userData\?\.native_language/
        );
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
