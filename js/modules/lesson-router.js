// --- modules/lesson-router.js ---

/**
 * Platform-Agnostic Lesson & Course Routing
 *
 * All functions are pure (no DOM/localStorage side effects) unless noted.
 * Side effects (saving progress, updating URL) must be handled by the caller.
 *
 * NOTE: cleanBrowserUrlRoute() is intentionally web-only.
 * For native routing, the caller should handle URL/deep-link cleanup directly.
 */

/**
 * Resolves the current lesson ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlLessonId
 * 2. User profile and local storage parameters (most recent timestamp wins)
 * 3. First lesson in configData
 * @returns {string}
 */
export function resolveCurrentLessonId(configData, userData, courseId, context = {}) {
    if (!configData || typeof configData !== 'object') {
        throw new Error('resolveCurrentLessonId: Invalid or missing course configuration.');
    }

    const { urlLessonId, storedLessonId, storedTimestamp } = context;

    // Priority 1: Explicit URL param
    if (urlLessonId) return urlLessonId;

    // Priority 2: Most recent of WordPress profile vs localStorage (timestamp wins)
    let wpLessonId = null;
    let wpTimestamp = null;

    if (userData) {
        wpLessonId = userData[`${courseId}_current_lesson`] ?? null;
        const ts = userData[`${courseId}_lesson_timestamp`];
        wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
    }

    const lsTs = storedTimestamp && !isNaN(new Date(storedTimestamp).getTime())
        ? new Date(storedTimestamp)
        : null;

    const sources = [];
    if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
    if (storedLessonId && lsTs) sources.push({ lessonId: storedLessonId, timestamp: lsTs });

    if (sources.length === 1) return sources[0].lessonId;
    if (sources.length > 1) {
        sources.sort((a, b) => b.timestamp - a.timestamp);
        return sources[0].lessonId;
    }

    // Priority 3: First lesson in config
    if (configData.lessons?.length > 0 && configData.lessons[0].lessonId) {
        return configData.lessons[0].lessonId;
    }

    throw new Error('resolveCurrentLessonId: No lessons found in the course configuration.');
}

/**
 * Resolves the current course ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlCourseId
 * 2. WordPress user profile param (wpCourseId)
 * 3. Stored course ID
 * 4. Default: 'tutorial'
 * @returns {string}
 */
export function resolveCurrentCourseId(userData, context = {}) {
    const { urlCourseId, wpCourseId, storedCourseId } = context;

    if (urlCourseId) return urlCourseId;

    if (userData && typeof userData === 'object') {
        const fromProfile = wpCourseId || userData.current_course || null;
        if (fromProfile) return fromProfile;
    }

    if (storedCourseId) return storedCourseId;

    return 'tutorial';
}

/**
 * Cleans routing parameters from the browser URL without reloading the page.
 * WEB ONLY — for native, handle deep-link param cleanup in your navigation layer.
 */
export function cleanBrowserUrlRoute() {
    if (typeof window === 'undefined' || !window.history) return;

    const url = new URL(window.location.href);
    if (url.searchParams.has('lessonid') || url.searchParams.has('course')) {
        url.searchParams.delete('lessonid');
        url.searchParams.delete('course');
        window.history.replaceState({}, document.title, url.toString());
    }
}

/**
 * Returns the next question in the current lesson, or null if at the end.
 * Returns the first question as a fallback if the current question is not found —
 * if this happens in production it likely indicates a stale question reference.
 * @returns {object|null}
 */
export function getNextQuestion(currentQuestion, configData, currentLessonIndex) {
    if (!configData?.lessons || currentLessonIndex >= configData.lessons.length) return null;

    const currentLesson = configData.lessons[currentLessonIndex];
    const currentIndex = currentLesson.questions.findIndex(
        q => q.question === currentQuestion.question && q.cue === currentQuestion.cue
    );

    if (currentIndex === -1) {
        console.warn('[LessonRouter] getNextQuestion: current question not found in lesson — falling back to first question. This may indicate a stale question reference.');
        return currentLesson.questions[0];
    }

    if (currentIndex >= currentLesson.questions.length - 1) return null;

    return currentLesson.questions[currentIndex + 1];
}

/**
 * Redirects the user to the login screen with an encoded redirect URL.
 * WEB ONLY — for native, navigate to your login screen via your navigation stack.
 */
export function navigateToLogin(redirectUrl) {
    if (typeof window !== 'undefined') {
        window.location.href = `login.html?redirect=${encodeURIComponent(redirectUrl)}`;
    }
}

/**
 * Redirects the user to the homescreen.
 * WEB ONLY — for native, navigate to your home screen via your navigation stack.
 */
export function navigateToHome() {
    if (typeof window !== 'undefined') {
        window.location.href = 'homescreen.html';
    }
}