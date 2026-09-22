// --- modules/video-processor-logic.js ---

import { remoteSource } from './video-source.js';

export const TEXT_MODE_DURATION_MS = 3000;

// ---------------------------------------------------------------------------
// Share CTA (shareCta recap overlays) — platform-agnostic domain logic.
// Both the web and native renderers consume these; only the drawing differs.
// ---------------------------------------------------------------------------

// Placeholder domain — will later become the URL-shortener domain.
// Deliberately no scheme: the displayed URL is a bare host/path, single line,
// because viewers must type it in manually from the video.
export const SHARE_URL_BASE = 'example.com';

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

export function buildShareUrl(shareCode) {
    return `${SHARE_URL_BASE}/${shareCode}`;
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
export function resolveOverlayElements({ variant = 'fluency', hasShareCta = false, isFirst = false, tailing = false } = {}) {
    if (variant === 'shareCta') {
        return {
            fluencyCard: false,
            headlineBlock: hasShareCta,
            tailingCard: hasShareCta && tailing
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
// resolve to the defaults below ('fluency' / 'system').
const RECAP_OVERLAYS = ['fluency', 'shareCta', 'none'];
const RECAP_SOURCES = ['system', 'friend', 'none'];

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

/**
 * A share CTA renders only for a 'shareCta' recap that has a shareCode.
 * A 'shareCta' recap without one renders nothing — no fluency fallback.
 */
export function isShareCtaEnabled(variant, shareCode) {
    return variant === 'shareCta' && !!shareCode;
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
                const remoteUrl = this._getRemoteTarget(rec);
                if (remoteUrl && remoteSource(remoteUrl) === sources) {
                    plan.push({
                        type: 'remote',
                        targetId: remoteUrl,
                        subtitle: this._getStepCue(rec),
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
                trim: rec.meta?.trimTimestamps || null,
                subtitle: { en: userText, translation: rec.translation || null },
                isFirst: plan.length === 0,
                isTextMode: rec.isTextMode,
                duration: rec.duration
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
        return q.interactiveVideoUrl || q.introBackgroundVideoUrl || q.simpleVideoUrl || null;
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
            // Only include translation when userLang is non-English and a translation exists
            const lang = (this.userLang || 'en').toLowerCase();
            const translation = (lang !== 'en' && q.cue[lang]) ? q.cue[lang] : null;
            return { en, translation };
        }

        return null;
    }
}