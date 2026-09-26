// --- modules/lesson-progression.js ---
// Progression functions extracted from app.js.
// Manages step transitions, lesson advancement, progress bar, and tutor chat.
// Uses deps pattern (_deps) for callLoadStep and loadLessonContent to avoid circular imports.

import { appStore } from '../store/store.js';
import Strings from '../../data/strings.js';
import teacherAvatar from '../../assets/img/teacherprofile.webp';
import userAvatar from '../../assets/img/userprofile.png';
import aiAvatar from '../../assets/img/ai.webp';
import { trackEvent } from '../utils/posthog.js';

export function createProgression(deps) {
    const {
        addAILoadingMessage,
        getChatHistoryContext,
        askEnglishTutor,
        saveLessonProgress,
        playSound,
    } = deps;

    function updateProgressBar() {
        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
        const totalSteps = currentLesson.steps.length;
        const gs = appStore.getState();
        let currentSteps = gs.stepsAnswered;
        gs.setStepsAnswered(currentSteps + 1);
        const finalProgress = Math.min(Math.max((currentSteps / totalSteps) * 100, 10), 90);
        appStore.getState().setProgressPercent(`${finalProgress}%`);
    }

    function showCompletionMessage() {
        const msg = Strings.get('msg_lesson_complete_all', appStore.getState().userData?.native_language);
        const heading = msg.match(/<h3>(.*?)<\/h3>/)?.[1] || '';
        const body = msg.match(/<p>(.*?)<\/p>/)?.[1] || '';
        appStore.getState().setCompletionMessage({ heading, body });
    }

    function loadNextStep(currentStep, fluencyData, _deps = {}) {
        updateProgressBar();
        trackEvent('step_completed', {
            step_index: appStore.getState().currentStepIndex,
            step_type: currentStep.responseType,
            is_last_step: appStore.getState().currentStepIndex >= (appStore.getState().configData?.lessons?.[appStore.getState().currentLessonIndex]?.steps?.length || 0) - 1,
        });
        appStore.getState().resetForNextStep();
        appStore.getState().resetStepState();

        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];

        const loadLessonContent = _deps.loadLessonContent;

        appStore.setState({ currentStepIndex: appStore.getState().currentStepIndex + 1 });
        const nextStep = currentLesson.steps[appStore.getState().currentStepIndex];
        // Advancing in-app (not a page load) — the success step waits for its
        // clip to play and end before revealing the overlay.
        appStore.getState().setStepLoadedFromRestore(false);
        // callLoadStep must run before setPendingVideoPlayType so the new video element
        // is mounted before the video players' useLayoutEffect consumes the iOS transient
        // user activation. See iOS video playback fix.
        if (appStore.getState().currentStepIndex < currentLesson.steps.length) {
            _deps.callLoadStep(currentLesson.steps[appStore.getState().currentStepIndex], currentLesson, fluencyData);
        } else {
            if (currentLesson.nextLessonId) loadNextLesson({ callLoadStep: _deps.callLoadStep, loadLessonContent });
            else showCompletionMessage();
        }

        if (nextStep) {
            if (nextStep.interactiveVideoUrl) {
                appStore.getState().setPendingVideoPlayType('interactive');
            } else if (nextStep.simpleVideoUrl) {
                appStore.getState().setPendingVideoPlayType('simple');
            }
        }
    }

    async function loadNextLesson(_deps = {}) {
        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
        const nextLessonId = currentLesson.nextLessonId;
        console.log(`[Progression] loadNextLesson: ${currentLesson?.lessonId} → ${nextLessonId}`);
        trackEvent('next_lesson_triggered', {
            from_lesson_id: currentLesson?.lessonId,
            to_lesson_id: nextLessonId,
            has_next: !!nextLessonId,
        });

        if (nextLessonId) {
            appStore.setState({ pendingLessonNavigation: nextLessonId });

            saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData).then(progressResult => {
                if (progressResult.dayCountIncremented) {
                    appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
                }
            });

            setTimeout(() => {
                const nextLessonIndex = appStore.getState().configData.lessons.findIndex(l => l.lessonId === nextLessonId);
                if (nextLessonIndex !== -1) {
                    appStore.setState({ currentLessonIndex: nextLessonIndex });
                    appStore.getState().setProgress({ lessonId: nextLessonId, lessonIndex: nextLessonIndex, questionIndex: 0 });
                    appStore.getState().setCurrentLessonTimestamp(new Date().toISOString());
                }
            }, 500);
        } else {
            playSound('lesson-complete-sound');
            showCompletionMessage();
        }
    }

    async function handleTutorChatSubmit(rawText) {
        if (!rawText || !rawText.trim()) return;
        const wordCount = rawText.trim().split(/\s+/).length;
        appStore.getState().incrementUserTutorStats(wordCount);

        appStore.getState().addChatMessage({
            role: 'user',
            type: 'standard',
            content: rawText,
            userName: appStore.getState().userData?.display_name?.split(' ')[0] || 'User',
            userAvatarUrl: appStore.getState().userData?.profilePictureUrl || userAvatar
        });

        addAILoadingMessage(Strings.get('ai_thinking', appStore.getState().userData?.native_language));

        const context = getChatHistoryContext();
        try {
            const aiResponse = await askEnglishTutor(context, rawText);
            const aiWordCount = aiResponse.trim().split(/\s+/).length;
            appStore.getState().incrementAiTutorStats(aiWordCount);

            trackEvent('tutor_chat', {
                user_word_count: wordCount,
                ai_word_count: aiWordCount,
                success: true,
            });

            appStore.getState().removeAiLoadingMessage();

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'standard',
                content: aiResponse,
                botName: 'FluIntel AI',
                avatarUrl: aiAvatar
            });
        } catch (error) {
            trackEvent('tutor_chat', {
                user_word_count: wordCount,
                success: false,
                error: error.message,
            });
            console.error('[app] Error in askEnglishTutor:', error);
            appStore.getState().removeAiLoadingMessage();
        }
    }

    return { updateProgressBar, showCompletionMessage, loadNextStep, loadNextLesson, handleTutorChatSubmit };
}

// --- Backward-compatible free-function exports ---
// These allow existing importers (LessonContainer.jsx, app-infra.js) to keep working
// without immediately switching to the factory pattern.
// app-infra.js calls setProgressionDeps() to configure the default instance.

let _deps = {
    addAILoadingMessage: () => {},
    getChatHistoryContext: () => '',
    askEnglishTutor: async () => '',
    saveLessonProgress: async () => ({}),
    playSound: () => {},
};
let _instance = null;

export function setProgressionDeps(deps) {
    _deps = deps;
    _instance = null;
}

function getProgression() {
    if (!_instance) _instance = createProgression(_deps);
    return _instance;
}

export function updateProgressBar() { return getProgression().updateProgressBar(); }
export function showCompletionMessage() { return getProgression().showCompletionMessage(); }
export function loadNextStep(currentStep, fluencyData, _deps) { return getProgression().loadNextStep(currentStep, fluencyData, _deps); }
export function loadNextLesson(_deps) { return getProgression().loadNextLesson(_deps); }
export function handleTutorChatSubmit(rawText) { return getProgression().handleTutorChatSubmit(rawText); }
