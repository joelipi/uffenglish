// @web-only
// Pure planner for which lesson video to prefetch first, plus an executor that
// fetches the first video at high priority and defers the rest until idle at low
// priority so they never starve the first video. No DOM, no React.

export const PRELOAD_DEFER_TIMEOUT_MS = 5000;

// One slug per step, in the same precedence the loader uses
// (interactiveVideoUrl || simpleVideoUrl || introBackgroundVideoUrl).
// Falsy slugs are skipped; URLs are deduped in first-seen order.
export function planLessonPreload(lesson, buildVideoUrl) {
    const steps = Array.isArray(lesson?.steps) ? lesson.steps : [];
    const seen = new Set();
    const urls = [];
    for (const step of steps) {
        const slug = step?.interactiveVideoUrl || step?.simpleVideoUrl || step?.introBackgroundVideoUrl;
        if (!slug) continue;
        const url = buildVideoUrl(slug);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    return { immediate: urls.slice(0, 1), deferred: urls.slice(1) };
}

function defaultDeferSchedule(callback) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(callback, { timeout: PRELOAD_DEFER_TIMEOUT_MS });
    } else {
        setTimeout(callback, 0);
    }
}

export function preloadLessonVideos(plan, {
    fetchImpl = globalThis.fetch,
    schedule = defaultDeferSchedule,
} = {}) {
    const immediate = plan?.immediate ?? [];
    const deferred = plan?.deferred ?? [];
    for (const url of immediate) {
        fetchImpl(url, { priority: 'high' }).catch(() => {});
    }
    if (deferred.length) {
        schedule(() => {
            for (const url of deferred) {
                fetchImpl(url, { priority: 'low' }).catch(() => {});
            }
        });
    }
}
