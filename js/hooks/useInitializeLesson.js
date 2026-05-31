import { useCallback } from 'react';
import { appStore } from '../modules/store.js';
import { resolveCurrentLessonId } from '../modules/lessonRouting.js';
import { saveLessonProgress } from '../modules/user-profile.js';
import { loadLessonContent } from '../modules/lesson-loader.js';
import Strings from '../data/strings.js';

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
            const lesson = configData.lessons.find(l => l.lessonId === resolvedLessonId);
            if (!lesson) {
                throw new Error(`Lesson '${resolvedLessonId}' not found in course configuration.`);
            }

            await saveLessonProgress(courseId, resolvedLessonId, userData, { updateUserMeta: false, incrementCount: false });
            const lessonIndex = configData.lessons.findIndex(l => l.lessonId === resolvedLessonId);
            appStore.setState({ currentLessonIndex: lessonIndex });

            // Intentional window.preloadLessonAssets — web asset preloading injected
            // by index.html inline script. Guarded: if undefined (RN), just skipped.
            if (window.preloadLessonAssets) {
                const constructFirebaseUrl = (slug) => `https://r2.ultrafastfluency.com/assets/videos/${slug}.mp4`;
                await window.preloadLessonAssets(lesson, constructFirebaseUrl);
            }

            await loadLessonContent(lesson, { forceRestart });

            return { success: true, lesson, lessonIndex };
        } catch (error) {
            console.error("initializeLesson error:", error);
            appStore.getState().setIsLoaded(true);
            appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error', userData?.native_language));
            return { success: false, error };
        }
    }, [forceRestart]);

    return { initializeLesson };
}
