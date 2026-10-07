// --- modules/lessonRouting.js ---

import { appStore } from '../store/store.js';
import { resolveNextStepIndex } from './branch-choice-logic.js';

/**
 * Platform-Agnostic Lesson & Course Routing Utilities
 * and framework-agnostic.
 */

/**
 * Resolves the current lesson ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlLessonId
 * 2. Persisted store state, passed in via context.persistedLessonId
 * 3. User profile and local storage parameters (most recent timestamp wins)
 * 4. First lesson in configData
 * @param {object} configData
 * @param {object|null} userData
 * @param {string} courseId
 * @param {object} context
 * @param {string} [context.urlLessonId]
 * @param {string} [context.persistedLessonId]   - pass appStore.getState().activeLessonId here
 * @param {string} [context.storedLessonId]       - localStorage lesson ID
 * @param {string} [context.storedTimestamp]      - localStorage timestamp
 * @returns {string}
 */
export function resolveCurrentLessonId(configData, userData, courseId, context = {}) {
    if (!configData || typeof configData !== 'object') {
        throw new Error('resolveCurrentLessonId: Invalid or missing course configuration.');
    }

    const { urlLessonId, persistedLessonId, storedLessonId, storedTimestamp } = context;

    // Priority 1: Explicit URL param
    if (urlLessonId) return urlLessonId;

    // Priority 2: Persisted store state (passed in by caller — store not imported here)
    if (persistedLessonId && typeof persistedLessonId === 'string' && persistedLessonId.trim() !== '') {
        const lessonExists = configData.lessons?.some(lesson => lesson.lessonId === persistedLessonId);
        if (lessonExists) {
            console.log(`[LessonRouter] Resuming lesson from persisted state: ${persistedLessonId}`);
            return persistedLessonId;
        } else {
            console.warn(`[LessonRouter] Persisted lesson ID '${persistedLessonId}' not found in course configuration. Ignoring stale ID.`);
        }
    }

    // Priority 3: Most recent of user profile vs localStorage (timestamp wins)
    let profileLessonId = null;
    let profileTimestamp = null;

    if (userData) {
        profileLessonId = userData[`${courseId}_current_lesson`] ?? null;
        const ts = userData[`${courseId}_lesson_timestamp`];
        profileTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
    }

    const lsTs = storedTimestamp && !isNaN(new Date(storedTimestamp).getTime())
        ? new Date(storedTimestamp)
        : null;

    const sources = [];
    if (profileLessonId && profileTimestamp) sources.push({ lessonId: profileLessonId, timestamp: profileTimestamp });
    if (storedLessonId && lsTs) sources.push({ lessonId: storedLessonId, timestamp: lsTs });

    if (sources.length === 1) return sources[0].lessonId;
    if (sources.length > 1) {
        sources.sort((a, b) => b.timestamp - a.timestamp);
        return sources[0].lessonId;
    }

    // Priority 4: First lesson in config
    if (configData.lessons?.length > 0 && configData.lessons[0].lessonId) {
        return configData.lessons[0].lessonId;
    }

    throw new Error('resolveCurrentLessonId: No lessons found in the course configuration.');
}

/**
 * Resolves the current course ID from pure data inputs (in priority order):
 * 1. Explicitly passed urlCourseId
 * 2. User profile param (profileCourseId)
 * 3. Stored course ID
 * 4. Default: 'tutorial'
 * @param {object|null} userData
 * @param {object} context
 * @param {string} [context.urlCourseId]
 * @param {string} [context.profileCourseId]
 * @param {string} [context.storedCourseId]
 * @returns {string}
 */
export function resolveCurrentCourseId(userData, context = {}) {
    const { urlCourseId, profileCourseId, storedCourseId } = context;

    if (urlCourseId) return urlCourseId;

    if (userData && typeof userData === 'object') {
        const fromProfile = profileCourseId || userData.current_course || null;
        if (fromProfile) return fromProfile;
    }

    if (storedCourseId) return storedCourseId;

    return 'tutorial';
}

/**
 * Returns the next step in the current lesson, or null if at the end.
 * Uses store-tracked currentStepIndex primarily, falls back to content match.
 */
export function getNextStep(currentStep, configData, currentLessonIndex) {
    if (!configData?.lessons || currentLessonIndex >= configData.lessons.length) return null;

    const currentLesson = configData.lessons[currentLessonIndex];
    const storeIndex = appStore.getState().currentStepIndex;

    // Primary: use store index
    if (storeIndex >= 0 && storeIndex < currentLesson.steps.length) {
        const nextIndex = resolveNextStepIndex(currentStep, storeIndex);
        return nextIndex < currentLesson.steps.length ? currentLesson.steps[nextIndex] : null;
    }

    // Fallback: content-based findIndex
    console.warn('[getNextStep] Store index out of bounds, falling back to content lookup. storeIndex:', storeIndex);
    const currentIndex = currentLesson.steps.findIndex(
        q => q.step === currentStep.step && q.cue === currentStep.cue
    );

    if (currentIndex === -1) {
        console.warn('[getNextStep] current step not found in lesson — returning null');
        return null;
    }

    const nextIndex = resolveNextStepIndex(currentLesson.steps[currentIndex], currentIndex);
    return nextIndex < currentLesson.steps.length ? currentLesson.steps[nextIndex] : null;
}

/**
 * Helper to get a query parameter case-insensitively.
 * @param {URLSearchParams} urlParams
 * @param {string} paramName
 * @returns {string|null}
 */
export function getUrlParamCaseInsensitive(urlParams, paramName) {
    const target = paramName.toLowerCase();
    for (const [key, value] of urlParams.entries()) {
        if (key.toLowerCase() === target) {
            return value;
        }
    }
    return null;
}