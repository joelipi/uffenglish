// --- modules/video-processor-logic.js ---

/**
 * Platform-Agnostic Video Render Planner
 * Analyzes recordings and generates a flat, step-by-step blueprint
 * for both rendering the final stitched video and sequential playback.
 */
export class VideoRenderPlanner {
    constructor(recordings, configData, fluencyData) {
        this.recordings = recordings || [];
        this.configData = configData || {};
        this.fluencyData = fluencyData || { total: "NA" };
    }

    generatePlan() {
        const plan = [];

        for (let i = 0; i < this.recordings.length; i++) {
            const rec = this.recordings[i];
            const prevRec = i > 0 ? this.recordings[i - 1] : null;

            // Skip remote prompt if this is a retry of the same question
            const needsRemote = !(prevRec && rec.originalQuestionIndex === prevRec.originalQuestionIndex);

            if (needsRemote) {
                const remoteUrl = this._getRemoteTarget(rec);
                if (remoteUrl) {
                    plan.push({
                        type: 'remote',
                        targetId: remoteUrl,
                        subtitle: rec.cue,
                        isFirst: plan.length === 0
                    });
                }
            }

            // isFirst evaluated after remote push so webcam is correctly
            // marked first when there is no preceding remote step
            plan.push({
                type: 'webcam',
                blob: rec.blob,       // Used by web processor
                uri: rec.uri,         // Used by native processor
                trim: rec.meta?.trimTimestamps || null,
                subtitle: rec.userResponse,
                isFirst: plan.length === 0
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

    _getRemoteTarget(rec) {
        if (!this.configData.lessons) return null;
        const lesson = this.configData.lessons.find(l => l.lessonId === rec.originalLessonId);
        if (!lesson?.questions?.[rec.originalQuestionIndex]) return null;
        const q = lesson.questions[rec.originalQuestionIndex];
        return q.videoUrl || q.introBackgroundVideoUrl || null;
    }
}