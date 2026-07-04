// --- modules/video-processor-logic.js ---

export const TEXT_MODE_DURATION_MS = 3000;

/**
 * Platform-Agnostic Video Render Planner
 * Analyzes recordings and generates a flat, step-by-step blueprint
 * for both rendering the final stitched video and sequential playback.
 */
export class VideoRenderPlanner {
    constructor(recordings, configData, fluencyData, userLang = 'en') {
        this.recordings = recordings || [];
        this.configData = configData || {};
        this.fluencyData = fluencyData || { total: "NA" };
        this.userLang = userLang || 'en';
    }

    generatePlan() {
        const plan = [];

        for (let i = 0; i < this.recordings.length; i++) {
            const rec = this.recordings[i];
            const prevRec = i > 0 ? this.recordings[i - 1] : null;

            // Skip remote prompt if this is a retry of the same step
            const needsRemote = !(prevRec && rec.originalStepIndex === prevRec.originalStepIndex);

            if (needsRemote) {
                const remoteUrl = this._getRemoteTarget(rec);
                if (remoteUrl) {
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

        // Final tailing phase — fluency score display
        plan.push({
            type: 'tailing',
            durationMs: 4000,
            fluencyData: this.fluencyData
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
        if (!this.configData.lessons) return null;
        const lesson = this.configData.lessons.find(l => l.lessonId === rec.originalLessonId);
        if (!lesson?.steps?.[rec.originalStepIndex]) return null;
        const q = lesson.steps[rec.originalStepIndex];
        return q.interactiveVideoUrl || q.introBackgroundVideoUrl || null;
    }

    _getStepCue(rec) {
        // If a matchedCue was stored at answer-submission time, use it directly.
        // This gives the canonical filled-in variant for arrays/templates/regex cues.
        if (rec.matchedCue) {
            return { en: rec.matchedCue, translation: rec.translation || null };
        }

        if (!this.configData.lessons) return null;
        const lesson = this.configData.lessons.find(l => l.lessonId === rec.originalLessonId);
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