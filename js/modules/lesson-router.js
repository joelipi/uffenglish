// --- modules/lesson-router.js ---
// Removed side-effect imports: saveLessonProgress, saveCourseToUserProfile 

/**
 * Resolves the current lesson ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlLessonId
 * 2. User profile and local storage parameters (most recent timestamp wins)
 * 3. First lesson in configData
 * @returns {string}
 */
export function resolveCurrentLessonId(configData, userData, courseId, context = {}) {
    if (!configData || typeof configData !== 'object') throw new Error('Invalid or missing course configuration.');

    // Inject the previously hardcoded browser dependencies
    const { urlLessonId, storedLessonId, storedTimestamp } = context;

    let lessonId = null;

    if (urlLessonId) {
        lessonId = urlLessonId;
    }

    if (!lessonId) {
        let wpLessonId = null; let wpTimestamp = null;
        if (userData) {
            wpLessonId = userData[`${courseId}_current_lesson`] ?? null;
            const ts = userData[`${courseId}_lesson_timestamp`];
            wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
        }

        const lsTs = storedTimestamp && !isNaN(new Date(storedTimestamp).getTime()) ? new Date(storedTimestamp) : null;

        const sources = [];
        if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
        if (storedLessonId && lsTs) sources.push({ lessonId: storedLessonId, timestamp: lsTs });

        if (sources.length === 1) lessonId = sources[0].lessonId;
        else if (sources.length > 1) {
            sources.sort((a, b) => b.timestamp - a.timestamp);
            lessonId = sources[0].lessonId;
        }
    }

    if (!lessonId) {
        if (configData && configData.lessons && configData.lessons.length > 0 && configData.lessons[0].lessonId) {
            lessonId = configData.lessons[0].lessonId;
        } else {
            throw new Error('resolveCurrentLessonId: No lessons found in the course configuration.');
        }
    }

    // Side effects (saving progress, updating URL) must now be handled by the caller.
    return lessonId;
}

/**
 * Resolves the current course ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlCourseId
 * 2. WordPress user profile param (wpCourseId)
 * 3. Stored Course ID
 * 4. Default: 'pronunciation'
 * @returns {string}
 */
export function resolveCurrentCourseId(userData, context = {}) {
    // Inject the previously hardcoded browser dependencies
    const { urlCourseId, wpCourseId, storedCourseId } = context;

    let courseId = urlCourseId;

    if (!courseId) {
        if (userData && typeof userData === 'object') {
            courseId = wpCourseId || userData.current_course || null;
        }

        if (!courseId) {
            courseId = storedCourseId;
        }
    }

    if (!courseId) courseId = 'tutorial';

    // Side effects (saving to localstorage/userData) must now be handled by the caller.
    return courseId;
}