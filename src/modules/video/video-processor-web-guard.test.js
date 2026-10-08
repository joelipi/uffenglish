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

    it('trims the stitched recording and passes the recap overlay to the fallback', () => {
        const start = source.indexOf('export async function exportSegmentsToR2');
        const end = source.indexOf('export { MAX_R2_UPLOAD_BYTES };');
        const exportFn = source.slice(start, end);
        // Primary path: cut the segment out of the stitched recording.
        expect(exportFn).toMatch(/transcodeRangeToMp4\(/);
        // Fallback path: re-render with the recap's overlay options.
        expect(exportFn).toMatch(/renderStepToBlob\(/);
        expect(exportFn).toMatch(/transcodeToMp4WithFallback\(/);
        expect(exportFn).toMatch(/overlayVariant/);
        expect(exportFn).toMatch(/shareCta/);
        // Thumbnail sibling upload is preserved.
        expect(exportFn).toMatch(/getUgcThumbKey\(key\)/);
        expect(exportFn).toMatch(/step\.thumbBlob/);
        expect(exportFn).toMatch(/contentType: 'image\/jpeg'/);
        // The primary path must not be canvas/rAF bound.
        expect(exportFn).not.toMatch(/requestAnimationFrame/);
    });

    it('wires per-step range hooks into executeRenderLoop on both play paths', () => {
        expect(source).toMatch(/onStepStart = null, onStepEnd = null/);
        // onStepStart must fire on the primary AND the muted-retry success
        // paths; missing the retry path silently drops publishable clips.
        expect((source.match(/onStepStart\?\.\(step\)/g) || []).length).toBe(2);
        expect(source).toMatch(/onStepEnd\?\.\(step\)/);
        expect(source).toMatch(/onStepEnd\?\.\(plan\[stepIndex\]\)/);
    });

    it('captures calibrated publishable ranges during the recap pass', () => {
        const start = source.indexOf('const rawRanges = [];');
        const end = source.indexOf('recorder.start(1000);');
        expect(start).toBeGreaterThan(-1);
        const capture = source.slice(start, end);
        expect(capture).toMatch(/isPublishableClip\(step\)/);
        expect(capture).toMatch(/recordingStartAt = performance\.now\(\)/);
        expect(capture).toMatch(/calibrateSegmentRanges\(rawRanges, elapsedMs, probedDurationSec\)/);
        expect(capture).toMatch(/resolve\(\{ blob, ext, segments \}\)/);
    });

    it('renders the recap exactly once and keeps the re-render fallback', () => {
        expect((source.match(/await executeRenderLoop\(/g) || []).length).toBe(1);
        expect(source).toMatch(/async function renderStepToBlob\(/);
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

    it('resolves the recap language guest-first in process', () => {
        // A guest who chose Spanish must get a Spanish recap even when
        // userData.native_language is stale; the precedence is shared with
        // normalizeConfig (single-sourced via resolveConfigLanguage). The
        // per-segment export consumes ranges captured by process(), so it no
        // longer resolves the language itself.
        expect(source).toMatch(
            /import \{ resolveConfigLanguage \} from '\.\.\/bilingual\/config-normalizer\.js'/
        );
        // Assert the argument ORDER (guest first, profile second); a swap would
        // silently restore the exact regression this fix prevents.
        const uses = source.match(
            /const userLang = resolveConfigLanguage\(snapshot\.guestNativeLanguage, snapshot\.userData\?\.native_language\)/g
        ) || [];
        expect(uses).toHaveLength(1);
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

    it('measures overlay text through the DOM, not only canvas measureText', () => {
        // WebKit canvas measureText under-reports (sometimes ~0) complex-script
        // glyphs supplied by a fallback font, so the share-CTA headline/deadline
        // and subtitles neither shrink-to-fit nor centre (Bengali overflows the
        // right edge). Overlay layout must consult a hidden <span> with the same
        // font, which WebKit lays out correctly.
        expect(source).toMatch(/function measureTextWidthDom\(/);
        expect(source).toMatch(/function measureTextWidth\(/);
        expect(source).toMatch(/function drawCenteredLine\(/);
        // drawFittedLine must not rely on textAlign='center' for its origin.
        expect(source).toMatch(/context\.textAlign = 'left'/);
    });

    it('scales and centres the recap header instead of drawing it at natural size', () => {
        // The 1600×300 header art overflows a portrait canvas at natural size.
        // It must go through the shared (unit-tested) layout helper and be
        // drawn with the resulting rect.
        expect(source).toMatch(/resolveHeaderLayout/);
        const start = source.indexOf('const headerLayout = overlayImage?.complete');
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf('if (displayCanvas)', start);
        const block = source.slice(start, end);
        expect(block).toMatch(/resolveHeaderLayout\(\{/);
        expect(block).toMatch(/canvasWidth: canvas\.width/);
        expect(block).toMatch(/canvasHeight: canvas\.height/);
        expect(block).toMatch(
            /ctx\.drawImage\(\s*overlayImage,\s*headerLayout\.x, headerLayout\.y,\s*headerLayout\.width, headerLayout\.height\s*\)/
        );
        // The old natural-size / clipped draw must be gone.
        expect(block).not.toMatch(/drawImage\(overlayImage,\s*x,\s*0\)/);
        // The whole header layout is handed to the overlay so the prompt can sit
        // directly beneath the banner.
        expect(block).toMatch(/drawTextOverlay\([\s\S]*overlayVariant, shareCta, headerLayout\s*\)/);
    });

    it('paints the header band with a 100% opaque gradient before the banner', () => {
        const start = source.indexOf('const headerLayout = overlayImage?.complete');
        const end = source.indexOf('if (displayCanvas)', start);
        const block = source.slice(start, end);
        expect(block).toMatch(/createLinearGradient\(0, 0, 0, headerLayout\.headerBottom\)/);
        expect(block).toMatch(/addColorStop\(0, HEADER_GRADIENT_TOP\)/);
        expect(block).toMatch(/addColorStop\(1, HEADER_GRADIENT_BOTTOM\)/);
        // Opaque fills, not the translucent water alphas.
        expect(source).toMatch(/const HEADER_GRADIENT_TOP = '#3a8fd5'/);
        expect(source).toMatch(/const HEADER_GRADIENT_BOTTOM = '#00c0d8'/);
        expect(block).toMatch(/ctx\.fillRect\(0, 0, canvas\.width, headerLayout\.headerBottom\)/);
    });

    it('draws the share-code prompt directly under the banner, never over it', () => {
        // The prompt is positioned from the shared layout's textY (which is the
        // banner bottom + gap), not an overlapping fixed band.
        expect(source).toMatch(/shareCta = null, headerLayout = null\)/);
        const start = source.indexOf('if (headlineBlock && shareCta && headerLayout) {');
        const end = source.indexOf('if (tailingCard && shareCta) {');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const promptBlock = source.slice(start, end);
        expect(promptBlock).toMatch(/headerLayout\.textY/);
        expect(promptBlock).toMatch(/shareCta\.prompt/);
        // The old fixed-band headline placement must be gone.
        expect(source).not.toMatch(/bandCenterY = canvasHeight \* 0\.125/);
        expect(source).not.toMatch(/shareCta\.headline/);
    });

    it('uses the video-only header asset, not the website header', () => {
        expect(source).toMatch(/import videoHeaderImg from '\.\.\/\.\.\/assets\/img\/video-header\.png'/);
        expect(source).not.toMatch(/assets\/img\/header\.png/);
        expect((source.match(/overlayImage\.src = videoHeaderImg;/g) || [])).toHaveLength(2);
    });
});
