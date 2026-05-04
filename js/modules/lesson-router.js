// --- modules/lesson-router.js ---
import { State } from './state.js';
import { saveLessonProgress, saveCourseToUserProfile } from './user-profile.js';

/**
 * Resolves the current lesson ID from (in priority order):
 *   1. URL param `lessonid`
 *   2. User profile and localStorage (most recent timestamp wins)
 *   3. First lesson in configData
 * Writes the result to State.lessonId and cleans URL params.
 * @returns {Promise<string>}
 */
export async function getCurrentLessonId(configData, userData, courseId) {
    if (!configData || typeof configData !== 'object') throw new Error('Invalid or missing course configuration.');
    const urlParams = new URLSearchParams(window.location.search);
    const urlLessonId = urlParams.get('lessonid');

    let lessonId = null;

    if (urlLessonId) {
        lessonId = urlLessonId;
        const url = new URL(window.location.href);
        url.searchParams.delete('lessonid'); url.searchParams.delete('course');
        window.history.replaceState({}, document.title, url.toString());
    }

    if (!lessonId) {
        let wpLessonId = null; let wpTimestamp = null;
        if (userData) {
            wpLessonId = userData[`${courseId}_current_lesson`] ?? null;
            const ts = userData[`${courseId}_lesson_timestamp`];
            wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
        }

        const lsId = localStorage.getItem(`${courseId}_currentLessonId`);
        const lsTsStr = localStorage.getItem(`${courseId}_currentLessonTimestamp`);
        const lsTs = lsTsStr && !isNaN(new Date(lsTsStr).getTime()) ? new Date(lsTsStr) : null;

        const sources = [];
        if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
        if (lsId && lsTs) sources.push({ lessonId: lsId, timestamp: lsTs });

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
            throw new Error('getCurrentLessonId: No lessons found in the course configuration.');
        }
    }

    saveLessonProgress(courseId, lessonId, userData, { updateUserMeta: false, incrementCount: false });
    return lessonId;
}

/**
 * Resolves the current course ID from (in priority order):
 *   1. URL param `courseid`
 *   2. WordPress user profile via wp.apiFetch
 *   3. localStorage key `currentCourse`
 *   4. Default: 'pronunciation'
 * Writes the result to State.courseId, localStorage, and the user profile.
 * @returns {Promise<string>}
 */
export async function getCurrentcourseId(userData) {
    let courseId = new URLSearchParams(window.location.search).get('courseid');

    if (!courseId) {
        if (userData && typeof userData === 'object') {
            try {
                const userProfile = globalThis.wp ? await globalThis.wp.apiFetch({ path: '/custom/v1/user-profile' }) : {};
                courseId = userProfile.current_course || userData.current_course || null;
            } catch (error) {
                courseId = localStorage.getItem('currentCourse');
            }
        } else {
            courseId = localStorage.getItem('currentCourse');
        }
        if (!courseId) {
            courseId = localStorage.getItem('currentCourse');
        }
    }

    if (!courseId) courseId = 'pronunciation';
    localStorage.setItem('currentCourse', courseId);
    if (userData && typeof userData === 'object') await saveCourseToUserProfile(courseId, userData);
    return courseId;
}