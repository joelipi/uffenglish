// Pure decision logic for the speech-engine UI shown on the first-response
// mode chooser. Kept dependency-free (no store, no DOM) so it can be unit
// tested directly and reused by both web and native choosers.

// How long a first-time engine load may take before we surface the
// "taking longer than usual" guidance. Model downloads are a few MB and
// normally finish in a couple of seconds; 15s is comfortably anomalous.
export const ENGINE_SLOW_MS = 15000;

/**
 * Resolve which chooser UI to show.
 * - 'ready'   engine loaded — show voice modes (text is a last-resort link)
 * - 'failed'  engine gave up — show troubleshooting + retry + text fallback
 * - 'slow'    still loading past the slow threshold — show retry guidance
 * - 'loading' still loading — voice modes shown disabled, no text option
 */
export function getSpeechUiState({ isReady, isFailed, loadingMs = 0 } = {}) {
    if (isReady) return 'ready';
    if (isFailed) return 'failed';
    return loadingMs >= ENGINE_SLOW_MS ? 'slow' : 'loading';
}

/**
 * Classify a getUserMedia/MediaRecorder failure into a cause the UI can
 * map to actionable guidance.
 */
export function classifyMediaError(error) {
    const name = error?.name || '';
    switch (name) {
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'not_found';
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'PermissionDismissedError':
        case 'SecurityError':
            return 'denied';
        case 'NotReadableError':
        case 'TrackStartError':
        case 'AbortError':
            return 'busy';
        default:
            return 'generic';
    }
}

/**
 * Map a media failure to the strings key describing how to fix it.
 */
export function getMediaErrorStringKey(error) {
    switch (classifyMediaError(error)) {
        case 'not_found': return 'error_media_not_found';
        case 'denied': return 'error_media_denied';
        case 'busy': return 'error_media_busy';
        default: return 'error_media_generic';
    }
}
