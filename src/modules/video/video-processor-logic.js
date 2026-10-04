// --- modules/video-processor-logic.js ---

import { remoteSource } from './video-source.js';

export const TEXT_MODE_DURATION_MS = 3000;

// Anti-freeze bound for a segment whose media length could not be resolved by
// either the <video> element or the container probe. A corrupt/unreadable blob
// should not occur for a valid MediaRecorder recording, so this is only a last
// resort; 15 s is a short cap rather than the previous 60 s hang.
export const UNRESOLVED_SEGMENT_CAP_MS = 15000;

// Extra wall-clock grace added to a segment's wall-clock cap before the draw
// loop declares a stall (covers decode/buffer hiccups).
export const STALL_GRACE_MS = 2000;

/**
 * Pure decision for when a non-tailing segment should stop advancing. Returns
 * the timestamp `endTime` the draw loop compares against `video.currentTime`,
 * and `wallClockCapMs` — the wall-clock budget derived from the resolved media
 * length, after which the stall guard forces an advance.
 *
 * Rule, in priority order (first match wins):
 *   1. explicit `trimEnd`          → exact trim end
 *   2. finite `rawDuration`        → the <video> element's real media length
 *   3. finite positive fallback    → probed container duration
 *   4. otherwise                   → no timestamp end (Infinity); only the
 *      wall-clock cap (UNRESOLVED_SEGMENT_CAP_MS) can advance.
 *
 * `step.duration` (net speaking time) is deliberately never consulted.
 */
export function resolveSegmentBounds({ trimEnd, rawDuration, fallbackDurationSec, start = 0 } = {}) {
    const safeStart = Number.isFinite(start) ? start : 0;
    if (trimEnd) {
        return { endTime: trimEnd, wallClockCapMs: Math.max(0, (trimEnd - safeStart) * 1000) };
    }
    if (Number.isFinite(rawDuration)) {
        return { endTime: rawDuration, wallClockCapMs: Math.max(0, (rawDuration - safeStart) * 1000) };
    }
    if (Number.isFinite(fallbackDurationSec) && fallbackDurationSec > 0) {
        return { endTime: fallbackDurationSec, wallClockCapMs: Math.max(0, (fallbackDurationSec - safeStart) * 1000) };
    }
    return { endTime: Infinity, wallClockCapMs: UNRESOLVED_SEGMENT_CAP_MS };
}

// ---------------------------------------------------------------------------
// Share CTA (shareCta recap overlays) — platform-agnostic domain logic.
// Both the web and native renderers consume these; only the drawing differs.
// ---------------------------------------------------------------------------

// Share host used by the recap CTA and the public-profile friend link.
// Deliberately no scheme: the displayed URL is a bare host/path, single line,
// because viewers must type it in manually from the video. The public-profile
// link adds the https scheme via toFriendLessonHref.
export const SHARE_URL_BASE = 'ultrafastfluency.com';

// The share window matches the R2 UGC lifecycle: videos/ objects expire after
// 48h (README.md:98, Cloudflare dashboard R2 → uff → Lifecycle). The friend
// must answer before the clips vanish.
export const SHARE_WINDOW_HOURS = 48;

// Locale map for the CTA deadline. Mirrors the LOCALE_MAP pattern in
// UserProfile.jsx:113 but covers this feature's six languages (adds BN).
const CTA_LOCALE_MAP = { EN: 'en', ES: 'es', PT: 'pt', FR: 'fr', HI: 'hi', BN: 'bn' };

function ctaLocale(nativeLanguage) {
    const code = String(nativeLanguage || 'en').split('-')[0].toUpperCase();
    return CTA_LOCALE_MAP[code] || 'en';
}

// Fallback when the session has no shareCode: point viewers at the bare host
// (the app) rather than a personalised invite link.
export function buildShareUrl(shareCode) {
    return shareCode ? `${SHARE_URL_BASE}/${shareCode}` : SHARE_URL_BASE;
}

export function buildShareDeadline(nowMs, nativeLanguage) {
    const deadline = new Date(nowMs + SHARE_WINDOW_HOURS * 60 * 60 * 1000);
    return deadline.toLocaleString(ctaLocale(nativeLanguage), {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Pure decision table for the overlay cards. Keeps the rendering rules
 * unit-testable without a canvas 2D context, and shared across platforms.
 *
 * - fluencyCard: the legacy CALCULATING FLUENCY / FLUENCY SCORE card
 * - headlineBlock: the 2-line share headline shown for the whole recap
 * - tailingCard: the 3-line CTA card shown during the tailing freeze-frame
 *
 * `variant` is the lesson's resolved `recapOverlay` ('fluency' | 'shareCta' |
 * 'none'); unknown values fall through to the fluency branch.
 */
export function resolveOverlayElements({ variant = 'fluency', isFirst = false, tailing = false } = {}) {
    if (variant === 'shareCta') {
        return {
            fluencyCard: false,
            headlineBlock: true,
            tailingCard: !!tailing
        };
    }
    if (variant === 'none') {
        return {
            fluencyCard: false,
            headlineBlock: false,
            tailingCard: false
        };
    }
    return {
        fluencyCard: !!isFirst || !!tailing,
        headlineBlock: false,
        tailingCard: false
    };
}

// Allowed values for the lesson-level recap flags. Unknown/absent values
// resolve to the defaults below ('fluency' / 'system'). Exported so config
// tests share the canonical lists instead of duplicating them.
export const RECAP_OVERLAYS = ['fluency', 'shareCta', 'none'];
export const RECAP_SOURCES = ['system', 'friend', 'none'];

/**
 * Resolves the lesson's recap overlay mode. Absent, empty, or unrecognized
 * values default to 'fluency' so unflagged lessons keep today's behaviour.
 */
export function resolveRecapOverlay(lesson) {
    const value = lesson?.recapOverlay;
    return RECAP_OVERLAYS.includes(value) ? value : 'fluency';
}

/**
 * Resolves the lesson's recap prompt-source mode. Absent, empty, or
 * unrecognized values default to 'system' so unflagged lessons keep today's
 * behaviour (system prompt videos interleaved with the user's webcam clips).
 */
export function resolveRecapSources(lesson) {
    const value = lesson?.recapSources;
    return RECAP_SOURCES.includes(value) ? value : 'system';
}

// Response steps that begin a new question. A friend-prompt fallback lookup
// must never scan past one of these: every friend clip belongs to exactly the
// question that immediately follows it.
const RECAP_RESPONSE_BOUNDARY_TYPES = new Set(['closedResponse', 'openResponse', 'friendClosedResponse']);

// Resolves a step's prompt video with the same precedence as the recorded
// step's own target: interactive > intro background > simple.
function stepTarget(step) {
    return step?.interactiveVideoUrl || step?.introBackgroundVideoUrl || step?.simpleVideoUrl || null;
}

/**
 * A share CTA renders for any 'shareCta' recap. When the session has no
 * shareCode, `buildShareUrl` falls back to the bare host so the CTA still
 * renders (headline + tailing card) instead of nothing.
 */
export function isShareCtaEnabled(variant) {
    return variant === 'shareCta';
}

/**
 * A remote prompt step that has been dropped because its clip could not be
 * fetched (`remoteFailed`) or decoded/played (`loadFailed`). The render loop
 * skips dropped steps and ignores them when picking the recap's opening step.
 */
export function isDroppedStep(step) {
    return step?.type === 'remote' && (step.remoteFailed === true || step.loadFailed === true);
}

/**
 * Marks the first renderable step at/after `fromIndex` as `isFirst` (the flag
 * that draws the fluency card on the opening segment). Renderable = not the
 * tailing step and not a dropped remote prompt. Returns its index, or -1.
 */
export function markFirstRenderable(plan, fromIndex = 0) {
    plan.forEach(s => { s.isFirst = false; });
    for (let i = fromIndex; i < plan.length; i++) {
        const step = plan[i];
        if (step.type === 'tailing' || isDroppedStep(step)) continue;
        step.isFirst = true;
        return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Publishing targets — which lesson a recorded step's clip publishes under.
// The R2 key is normally generated from the lesson being exported, but a step
// may override it (e.g. ask-question steps embedded in an answer lesson publish
// under the ask lesson so a friend's answer lesson can fetch them).
// ---------------------------------------------------------------------------

// The lesson a step's clip publishes under. Absent/empty `publishLessonId`
// falls back to the lesson being exported (today's behaviour).
export function resolvePublishLessonId(step, defaultLessonId) {
    return (step && step.publishLessonId) || defaultLessonId;
}

// Assigns each publishable segment its { lessonId, index } — index is 1-based
// and restarts per target lesson, in input order. Position-based, so a segment
// that fails to upload leaves a gap rather than renumbering the ones after it.
export function assignSegmentTargets(publishable, defaultLessonId) {
    const counts = {};
    return (publishable || []).map((step) => {
        const lessonId = resolvePublishLessonId(step, defaultLessonId);
        const index = (counts[lessonId] || 0) + 1;
        counts[lessonId] = index;
        return { lessonId, index };
    });
}

// The R2 key for a user-generated segment.
export function buildUgcSegmentKey({ shareCode, courseId, lessonId, index }) {
    return `videos/${shareCode}-${courseId}-${lessonId}-response-${String(index).padStart(2, '0')}.mp4`;
}

// ---------------------------------------------------------------------------
// Per-segment publish — clip selection and range calibration.
//
// The whole lesson is rendered once into a single stitched recording; the
// per-segment clips are trimmed out of that recording. Which plan steps have a
// clip, and where each clip sits on the recording timeline, are pure decisions.
// ---------------------------------------------------------------------------

// A publishable clip is the user's own webcam answer with a real blob. Remote
// (model/friend) prompt clips and text-mode avatar cards are never published.
export function isPublishableClip(step) {
    return !!step && step.type === 'webcam' && !!step.blob && !step.isTextMode;
}

// Shorter than this and the "clip" is a failed-load artifact (a step that never
// played), not a real answer.
export const MIN_SEGMENT_SECONDS = 0.4;

// The recorder can start a little after `recorder.start()`, so the probe-derived
// offset is normally sub-second. If the probed duration disagrees with the
// wall-clock recording length by more than this, the probe is unreliable (a
// MediaRecorder mp4 can report a bogus tiny duration) and is ignored.
export const MAX_CALIBRATION_OFFSET_SEC = 2;

/**
 * Converts wall-clock step ranges (ms since `recorder.start()`) into trimmed
 * ranges in seconds against the recording's own timeline.
 *
 * The recorder can begin a little after `recorder.start()`, so the raw offsets
 * are shifted earlier by whatever the recording is shorter than the elapsed
 * wall-clock (`elapsedMs/1000 - probedDurationSec`). The probe is only trusted
 * when it agrees with the wall clock within `MAX_CALIBRATION_OFFSET_SEC`;
 * otherwise the raw wall-clock offsets are used unshifted (still within the
 * recorder start-lag error) so a bogus probe cannot push every range out of
 * bounds. Sub-floor ranges are always dropped.
 *
 * @param {Array<{step: object, startMs: number, endMs: number}>} rawRanges
 * @param {number} elapsedMs wall-clock from `recorder.start()` to the end
 * @param {number|null} probedDurationSec the recording's reported duration
 * @returns {Array<{step: object, startSec: number, endSec: number}>}
 */
export function calibrateSegmentRanges(rawRanges, elapsedMs, probedDurationSec) {
    const ranges = Array.isArray(rawRanges) ? rawRanges : [];
    const elapsedSec = Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0;
    const probeDuration = Number.isFinite(probedDurationSec) && probedDurationSec > 0 ? probedDurationSec : null;
    const rawOffsetSec = probeDuration === null ? 0 : elapsedSec - probeDuration;
    const probeUsable = probeDuration !== null && Math.abs(rawOffsetSec) <= MAX_CALIBRATION_OFFSET_SEC;
    const offsetSec = probeUsable ? rawOffsetSec : 0;

    const calibrated = [];
    for (const range of ranges) {
        if (!range || !range.step) continue;
        if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) continue;
        let startSec = range.startMs / 1000 - offsetSec;
        let endSec = range.endMs / 1000 - offsetSec;
        if (probeUsable) {
            startSec = Math.max(0, Math.min(startSec, probeDuration));
            endSec = Math.max(0, Math.min(endSec, probeDuration));
        }
        if (endSec - startSec < MIN_SEGMENT_SECONDS) continue;
        calibrated.push({ step: range.step, startSec, endSec });
    }
    return calibrated;
}

/**
 * Platform-Agnostic Video Render Planner
 * Analyzes recordings and generates a flat, step-by-step blueprint
 * for both rendering the final stitched video and sequential playback.
 */
export class VideoRenderPlanner {
    constructor(recordings, configData, fluencyData, userLang = 'en', shareCode = null) {
        this.recordings = recordings || [];
        this.configData = configData || {};
        this.fluencyData = fluencyData || { total: "NA" };
        this.userLang = userLang || 'en';
        this.shareCode = shareCode || null;
    }

    /**
     * Resolves the lesson config for a recording. All recordings in a plan share
     * one originalLessonId (storage filters by it), so any recording identifies
     * the lesson.
     */
    _getLesson(rec) {
        if (!this.configData.lessons) return null;
        return this.configData.lessons.find(l => l.lessonId === rec.originalLessonId) || null;
    }

    /**
     * The lesson this recording should publish under, from the step's optional
     * `publishLessonId` (null → the lesson being exported). Carried onto the
     * webcam plan step so the exporter can group segments by target.
     */
    _getPublishLessonId(rec) {
        const lesson = this._getLesson(rec);
        const step = lesson?.steps?.[rec.originalStepIndex];
        return step?.publishLessonId || null;
    }

    generatePlan() {
        const plan = [];

        for (let i = 0; i < this.recordings.length; i++) {
            const rec = this.recordings[i];
            const prevRec = i > 0 ? this.recordings[i - 1] : null;

            // Skip remote prompt if this is a retry of the same step
            const needsRemote = !(prevRec && rec.originalStepIndex === prevRec.originalStepIndex);

            // The lesson's recapSources mode decides which prompt-video
            // category is concatenated ('system' | 'friend' | 'none'). The
            // user's own webcam clips are always included. With 'friend',
            // every friend prompt is concatenated regardless of any other
            // lesson flag, and system prompts never appear.
            const lesson = this._getLesson(rec);
            const sources = resolveRecapSources(lesson);

            if (needsRemote) {
                const remoteSlug = this._getRemoteTarget(rec);
                if (remoteSlug && remoteSource(remoteSlug) === sources) {
                    // Friend (UGC) clips are already captioned: they are
                    // published per-segment with their own speaker's cue burned
                    // in (exportSegmentsToR2 -> renderStepToBlob). Drawing the
                    // response step's cue here would stamp the current user's
                    // answer onto the friend's question video, so a friend
                    // prompt gets no recap subtitle.
                    const isFriendClip = remoteSource(remoteSlug) === 'friend';
                    plan.push({
                        type: 'remote',
                        targetId: remoteSlug,
                        subtitle: isFriendClip ? null : this._getStepCue(rec),
                        isFirst: plan.length === 0
                    });
                }
            }

            // --- CRITICAL FIX ---
            // Aggressively hunt for the transcription. If the AI moved it inside the meta object 
            // or renamed it to 'transcript' during the refactor, this ensures we still find it.
            let userText = rec.userResponse;
            if (!userText && rec.meta) {
                userText = rec.meta.userResponse || rec.meta.transcript || rec.meta.text;
            }
            userText = userText || rec.transcript || rec.text || rec.answer || "";
            // --------------------

            // isFirst evaluated after remote push so webcam is correctly
            // marked first when there is no preceding remote step
            plan.push({
                type: 'webcam',
                blob: rec.blob,       // Used by web processor
                uri: rec.uri,         // Used by native processor
                // Carry the generated webcam thumb into the publish plan so
                // exportSegmentsToR2 uploads the sibling .jpg. Storage only ever
                // exposes the thumb as a Blob on the record (`thumbBlob`);
                // a record restored from IndexedDB has its ArrayBuffer form
                // converted back to `thumbBlob` before it reaches the planner
                // (storage.web.js restoreRecordingsForLesson), so there is no
                // separate ArrayBuffer field to carry.
                thumbBlob: rec.thumbBlob || null,
                trim: rec.meta?.trimTimestamps || null,
                subtitle: this._getResponseSubtitle(rec, userText),
                isFirst: plan.length === 0,
                isTextMode: rec.isTextMode,
                duration: rec.duration,
                // Lesson this clip publishes under (null → the exported lesson).
                publishLessonId: this._getPublishLessonId(rec)
            });
        }

        // Final tailing phase — fluency score display, or the share CTA for
        // shareCta recaps. All recordings in a plan share one
        // originalLessonId, so the first recording identifies the lesson. Empty
        // recordings → no lesson resolvable → safe default 'fluency'.
        const tailingLesson = this.recordings.length ? this._getLesson(this.recordings[0]) : null;
        plan.push({
            type: 'tailing',
            durationMs: 4000,
            fluencyData: this.fluencyData,
            variant: resolveRecapOverlay(tailingLesson),
            shareCode: this.shareCode
        });

        return plan;
    }

    /**
     * Generates a sequential playback playlist from the render plan.
     * Used by native to drive the review player while stitching runs in background.
     * Each entry has a uri and optional trim so the player knows what to play and when to cut.
     */
    generatePlaylist(resolvedUris) {
        // resolvedUris: Map<stepIndex, localUri> — provided by native after segment resolution
        return resolvedUris.map(({ uri, trim, step }) => ({
            uri,
            trim,
            subtitle: step.subtitle || null,
            type: step.type,
            fluencyData: step.type === 'tailing' ? step.fluencyData : null
        }));
    }

    /**
     * Calculates the target canvas/video dimensions for a high-quality vertical output.
     * Ensures height is at least 1080p and width is proportional.
     */
    getTargetDimensions(srcW, srcH) {
        let targetW = srcW || 1080;
        let targetH = srcH || 1920;
        const isPortrait = targetH > targetW;

        if (isPortrait) {
            if (targetH < 1080) {
                const scale = 1080 / targetH;
                targetW = Math.round(targetW * scale);
                targetH = 1080;
            }
        } else {
            if (targetW < 1920) {
                const scale = 1920 / targetW;
                targetW = 1920;
                targetH = Math.round(targetH * scale);
            }
        }

        // Ensure dimensions are even for video codecs
        if (targetW % 2) targetW++;
        if (targetH % 2) targetH++;

        return { width: targetW, height: targetH };
    }

    /**
     * Calculates letterbox/pillarbox coordinates for drawing a source video onto a target canvas.
     */
    calculateLayout(srcW, srcH, dstW, dstH) {
        const srcRatio = srcW / srcH;
        const dstRatio = dstW / dstH;

        let drawW = dstW;
        let drawH = dstH;
        let x = 0;
        let y = 0;

        if (srcRatio > dstRatio) {
            // Source is wider than destination (landscape on portrait)
            drawH = dstW / srcRatio;
            y = (dstH - drawH) / 2;
        } else {
            // Source is taller than destination
            drawW = dstH * srcRatio;
            x = (dstW - drawW) / 2;
        }

        return { x, y, width: drawW, height: drawH };
    }

    _getRemoteTarget(rec) {
        const lesson = this._getLesson(rec);
        if (!lesson?.steps?.[rec.originalStepIndex]) return null;
        const q = lesson.steps[rec.originalStepIndex];
        // Include simpleVideoUrl as a fallback so steps whose prompt is the
        // model-answer clip (not an interactive/intro video) still get a remote
        // prompt segment in the generated recap. Order: interactive > intro > simple.
        const own = stepTarget(q);
        if (own && remoteSource(own) === 'friend') return own;

        // Friend-challenge lessons may present the friend's question as a
        // click-through `viewAndContinue` step immediately before the recorded
        // response step, whose own prompt is the teacher's system clip. Borrow
        // that preceding friend clip so the recap keeps the friend's half of
        // the conversation. Scan back only to the previous response boundary so
        // a question never reuses an earlier question's clip.
        if (resolveRecapSources(lesson) === 'friend') {
            for (let i = rec.originalStepIndex - 1; i >= 0; i--) {
                const step = lesson.steps[i];
                if (RECAP_RESPONSE_BOUNDARY_TYPES.has(step?.responseType)) break;
                const target = stepTarget(step);
                if (target && remoteSource(target) === 'friend') return target;
            }
        }

        return own;
    }

    /**
     * Subtitle for a learner's recorded (webcam) segment. A closed-response step
     * burns the specific cue variant the transcript matched (`rec.matchedCue`, with
     * its localized `rec.translation`) and nothing when there was no match — a
     * no-match means the answer was wrong, so neither the transcript nor a guessed
     * cue belongs on the video. A non-cue step (open response) keeps burning the
     * transcript.
     */
    _getResponseSubtitle(rec, userText) {
        const step = this._getLesson(rec)?.steps?.[rec.originalStepIndex];
        const isClosedResponse =
            step?.responseType === 'closedResponse' ||
            step?.responseType === 'friendClosedResponse';

        if (!isClosedResponse) {
            return { en: userText, translation: rec.translation || null };
        }

        if (typeof rec.matchedCue === 'string' && rec.matchedCue.length > 0) {
            return { en: rec.matchedCue, translation: rec.translation || null };
        }

        return null; // wrong answer: no subtitle
    }

    _getStepCue(rec) {
        // If a matchedCue was stored at answer-submission time, use it directly.
        // This gives the canonical filled-in variant for arrays/templates/regex cues.
        if (rec.matchedCue) {
            return { en: rec.matchedCue, translation: rec.translation || null };
        }

        const lesson = this._getLesson(rec);
        if (!lesson?.steps?.[rec.originalStepIndex]) return null;
        const q = lesson.steps[rec.originalStepIndex];

        // Cue is a plain string — no translation available
        if (typeof q.cue === 'string') return { en: q.cue, translation: null };

        // Cue is a multi-language object (e.g. { en: "Hello", es: "Hola" })
        if (q.cue && typeof q.cue === 'object') {
            const en = q.cue.en || '';
            // Only include translation when userLang is non-English and a
            // translation exists. Strip any region subtag ('BN', 'bn-BD' → 'bn')
            // so a region-tagged profile language still resolves the cue.
            const lang = (this.userLang || 'en').split('-')[0].toLowerCase();
            const translation = (lang !== 'en' && q.cue[lang]) ? q.cue[lang] : null;
            return { en, translation };
        }

        return null;
    }
}