// --- modules/video-source.js ---
// Pure friend-vs-system video classification, shared by the URL resolver
// (video-url.js) and the recap planner (video-processor-logic.js).
// No browser globals, no URL construction — safe for any platform.

// A friend/UGC clip is identified by its slug ending in "-response-NN"
// (e.g. "{shareCode}-model-w-response-01" after {friendCode} substitution).
// This is the same convention getVideoUrl uses to route UGC to the /videos/
// namespace (48h TTL) instead of the teacher /assets/videos/ namespace.
export const FRIEND_VIDEO_REGEX = /-response-\d+$/i;

export function isFriendVideoSlug(slug) {
    return typeof slug === 'string' && FRIEND_VIDEO_REGEX.test(slug);
}

export function remoteSource(slug) {
    return isFriendVideoSlug(slug) ? 'friend' : 'system';
}