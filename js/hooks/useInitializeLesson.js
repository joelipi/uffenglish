import { useCallback, useRef } from 'react';
import { appStore } from '../modules/store.js';
import { useStepLoader } from './useStepLoader.js';
import {
    resolveCurrentLessonId,
    getUrlParamCaseInsensitive
} from '../modules/lessonRouting.js';
import { saveLessonProgress } from '../modules/user-profile.js';
import { clearSpeechRecordingsForLesson } from '../modules/storage.js';
import { updateProgressBar } from '../modules/lesson-progression.js';
import Strings from '../data/strings.js';

export function useInitializeLesson() {
    const stepLoaderDepsRef = useRef(null);
    const { loadStep } = useStepLoader();

    const setStepLoaderDeps = useCallback((deps) => {
        stepLoaderDepsRef.current = deps;
    }, []);

    const initializeLesson = useCallback(async (courseId, lessonId, configData, userData) => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const pathLessonMatch = window.location.pathname.match(/^\/course\/([^/]+)\/lesson\/([^/]+)/);
            const routerContext = {
                urlLessonId: pathLessonMatch?.[2] || getUrlParamCaseInsensitive(urlParams, 'lessonid'),
                storedLessonId: localStorage.getItem(`${courseId}_currentLessonId`),
                storedTimestamp: localStorage.getItem(`${courseId}_currentLessonTimestamp`)
            };

            const resolvedLessonId = resolveCurrentLessonId(configData, userData, courseId, routerContext);

            if (!configData || !configData.lessons) {
                throw new Error("No course configuration or lessons available.");
            }
            const lesson = configData.lessons.find(l => l.lessonId === resolvedLessonId);
            if (!lesson) {
                throw new Error(`Lesson '${resolvedLessonId}' not found in course configuration.`);
            }

            if (routerContext.urlLessonId && window.location.search) {
                const url = new URL(window.location.href);
                const keysToDelete = [];
                for (const key of url.searchParams.keys()) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === 'lessonid' || lowerKey === 'course' || lowerKey === 'courseid') {
                        keysToDelete.push(key);
                    }
                }
                if (keysToDelete.length > 0) {
                    keysToDelete.forEach(key => url.searchParams.delete(key));
                    window.history.replaceState({}, document.title, url.toString());
                }
            }

            await saveLessonProgress(courseId, resolvedLessonId, userData, { updateUserMeta: false, incrementCount: false });
            const lessonIndex = configData.lessons.findIndex(l => l.lessonId === resolvedLessonId);
            appStore.setState({ currentLessonIndex: lessonIndex });

            if (window.preloadLessonAssets) {
                const constructFirebaseUrl = (slug) => `https://r2.ultrafastfluency.com/assets/videos/${slug}.mp4`;
                await window.preloadLessonAssets(lesson, constructFirebaseUrl);
            }

            await loadLessonContent(lesson, configData);

            return { success: true, lesson, lessonIndex };
        } catch (error) {
            console.error("initializeLesson error:", error);
            appStore.getState().setIsLoaded(true);
            appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error', userData?.native_language));
            return { success: false, error };
        }
    }, [loadStep]);

    async function loadLessonContent(lesson, configData) {
        try {
            await clearSpeechRecordingsForLesson(lesson.lessonId);
        } catch (e) {
            console.error(e);
        }

        const player = appStore.getState().currentVideoPlayer;
        if (player) player.destroy();
        appStore.getState().resetLessonState();
        appStore.getState().setLessonStartTime(new Date().toISOString());
        appStore.getState().setRoleOther(lesson.roleOther || "");
        appStore.getState().setRoleUser(lesson.roleUser || "");
        appStore.getState().setUserRole(lesson.userRole || "");
        appStore.getState().setVideoRole(lesson.videoRole || "");

        updateProgressBar(lesson);

        const course = configData?.courseName || "";
        const englishLevel = configData?.languageLevel || 'A0';
        const level = englishLevel ? ` (${englishLevel})` : "";
        const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
        const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
        const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

        appStore.setState({
            currentStepIndex: 0,
            lessonTitle: fullTitle,
            isLessonActive: true
        });

        const deps = stepLoaderDepsRef.current;
        if (deps) {
            const currentStepIndex = appStore.getState().currentStepIndex;
            loadStep(lesson.steps[currentStepIndex], lesson, null, deps);
        }
    }

    return { initializeLesson, setStepLoaderDeps };
}
