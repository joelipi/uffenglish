// @web-only
// Web-only lesson initialization hook.
// Uses window.preloadLessonAssets — a web asset preloader injected by index.html
// inline script. Guarded: in React Native the guard skips preloading entirely.

import { useCallback } from 'react';
import { appStore } from '../modules/store/store.js';
import { resolveCurrentLessonId } from '../modules/lesson/lesson-routing.js';
import { saveLessonProgress } from '../modules/user/user-profile.js';
import { loadLessonContent } from '../modules/lesson/lesson-loader.js';
import Strings from '../data/strings.js';
import { getAppLanguageFor } from '../modules/bilingual/config-normalizer.js';
import { trackEvent } from '../modules/utils/posthog.js';
import { getVideoUrl, getPosterUrl } from '../modules/video/video-url.js';
import { planLessonPreload, preloadLessonVideos } from '../modules/video/lesson-preload.js';
import {
    isLessonMissingFromConfig,
    isNotFoundError,
    markNotFoundError,
} from '../modules/lesson/lesson-not-found-logic.js';

export function useInitializeLesson({ forceRestart = false } = {}) {
    const initializeLesson = useCallback(async (courseId, lessonId, configData, userData) => {
        try {
            const routerContext = {
                urlLessonId: lessonId,
                persistedLessonId: appStore.getState().activeLessonId,
                storedLessonId: appStore.getState().activeLessonId,
                storedTimestamp: appStore.getState().currentLessonTimestamp
            };

            const resolvedLessonId = resolveCurrentLessonId(configData, userData, courseId, routerContext);

            if (!configData || !configData.lessons) {
                throw new Error("No course configuration or lessons available.");
            }
            // A lesson id that is not in the course is a DEAD LINK: the course
            // config was regenerated (or the lesson retired) while the link was
            // being handed out. Tag it so the caller answers with the not-found
            // page instead of the critical-error screen.
            if (isLessonMissingFromConfig(configData, resolvedLessonId)) {
                throw markNotFoundError(new Error(`Lesson '${resolvedLessonId}' not found in course configuration.`));
            }
            // The guard above proves this lookup matches, so it needs no second
            // check. The optional chaining keeps it aligned with the guard's
            // own predicate (a malformed config entry must not throw here).
            const lesson = configData.lessons.find(l => l?.lessonId === resolvedLessonId);

            await saveLessonProgress(courseId, resolvedLessonId, userData, { updateUserMeta: false, incrementCount: false });
            const lessonIndex = configData.lessons.findIndex(l => l.lessonId === resolvedLessonId);
            appStore.setState({ currentLessonIndex: lessonIndex });

            // Intentional window.preloadLessonAssets — web asset preloading injected
            // by index.html inline script. Guarded: if undefined (RN), just skipped.
            if (typeof window !== 'undefined' && window.preloadLessonAssets) {
                await window.preloadLessonAssets(lesson, getVideoUrl, getPosterUrl);
            }

            // Prefetch the lesson's first video at high priority, and defer the
            // rest until idle at low priority, so bulk prefetch cannot starve
            // the video the learner sees first (story 031).
            preloadLessonVideos(planLessonPreload(lesson, getVideoUrl));

            await loadLessonContent(lesson, { forceRestart });

            return { success: true, lesson, lessonIndex };
        } catch (error) {
            console.error("initializeLesson error:", error);
            trackEvent('lesson_init_error', {
                course_id: courseId,
                lesson_id: lessonId,
                error: error.message,
            });
            appStore.getState().setIsLoaded(true);
            // A dead link is not a technical failure: the route shows the
            // not-found page for it, so the critical-error screen (and its
            // "check your internet connection" message) must stay off.
            if (!isNotFoundError(error)) {
                appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error', getAppLanguageFor(userData)));
            }
            return { success: false, error };
        }
    }, [forceRestart]);

    return { initializeLesson };
}