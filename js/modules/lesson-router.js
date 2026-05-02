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
export async function getCurrentLessonId() {
    if (!State.configData || typeof State.configData !== 'object') throw new Error('Invalid or missing course configuration.');
    const urlParams = new URLSearchParams(window.location.search);
    const urlLessonId = urlParams.get('lessonid');

    if (urlLessonId) {
        State.lessonId = urlLessonId;
        const url = new URL(window.location.href);
        url.searchParams.delete('lessonid'); url.searchParams.delete('course');
        window.history.replaceState({}, document.title, url.toString());
    }

    if (!State.courseId) State.courseId = await getCurrentcourseId();

    if (!State.lessonId) {
        let wpLessonId = null; let wpTimestamp = null;
        if (State.userData) {
            wpLessonId = State.userData[`${State.courseId}_current_lesson`] ?? null;
            const ts = State.userData[`${State.courseId}_lesson_timestamp`];
            wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
        }

        const lsId = localStorage.getItem(`${State.courseId}_currentLessonId`);
        const lsTsStr = localStorage.getItem(`${State.courseId}_currentLessonTimestamp`);
        const lsTs = lsTsStr && !isNaN(new Date(lsTsStr).getTime()) ? new Date(lsTsStr) : null;

        const sources = [];
        if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
        if (lsId && lsTs) sources.push({ lessonId: lsId, timestamp: lsTs });

        if (sources.length === 1) State.lessonId = sources[0].lessonId;
        else if (sources.length > 1) {
            sources.sort((a, b) => b.timestamp - a.timestamp);
            State.lessonId = sources[0].lessonId;
        }
    }

    if (!State.lessonId) {
        if (State.configData && State.configData.lessons && State.configData.lessons.length > 0 && State.configData.lessons[0].lessonId) {
            State.lessonId = State.configData.lessons[0].lessonId;
        } else {
            throw new Error('getCurrentLessonId: No lessons found in the course configuration.');
        }
    }

    saveLessonProgress(State.courseId, State.lessonId, State.userData, { updateUserMeta: false, incrementCount: false });
    return State.lessonId;
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
export async function getCurrentcourseId() {
    State.courseId = new URLSearchParams(window.location.search).get('courseid');

    if (!State.courseId) {
        if (State.userData && typeof State.userData === 'object') {
            try {
                const userProfile = await wp.apiFetch({ path: '/custom/v1/user-profile' });
                State.courseId = userProfile.current_course || null;
            } catch (error) {
                State.courseId = localStorage.getItem('currentCourse');
            }
        } else {
            State.courseId = localStorage.getItem('currentCourse');
        }
    }

    if (!State.courseId) State.courseId = 'pronunciation';
    localStorage.setItem('currentCourse', State.courseId);
    if (State.userData && typeof State.userData === 'object') await saveCourseToUserProfile(State.courseId, State.userData);
    return State.courseId;
}