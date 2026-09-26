import { appStore, getAnswerPipelineDeps, getCurrentVideoPlayer } from '../store/store.js';
import { clearInMemoryRecordingsForLesson, clearSpeechRecordingsForLesson, restoreRecordingsForLesson } from '../storage/storage.js';
import { deleteRecordsExceptLesson } from '../storage/recordingDb.js';
import { loadStep } from '../../components/step-loader.js';
import { trackEvent } from '../utils/posthog.js';

export async function loadLessonContent(lesson, options = {}) {
    const { forceRestart = false } = options;

    // Clear in-memory Map entries for this lesson so old recordings from
    // a previous SPA navigation don't accumulate and pollute the video.
    // forceRestart additionally clears IndexedDB (see below).
    clearInMemoryRecordingsForLesson(lesson.lessonId);

    // Reclaim IndexedDB space from other lessons. There is no cross-lesson
    // replay, so recordings from lessons the user navigated away from are
    // safe to delete. This is independent from forceRestart, which clears the
    // CURRENT lesson's recordings (Repeat button).
    try {
        await deleteRecordsExceptLesson(lesson.lessonId);
        console.log('[LessonLoader] cleared IndexedDB recordings for other lessons');
    } catch (e) {
        console.warn('[LessonLoader] failed to clear other lessons recordings', e);
    }

    // Only clear recordings on explicit restart (Repeat button).
    // Normal re-mounts (page reload, signup redirect) preserve recordings
    // in the in-memory Map — they survive SPA navigation but are lost on
    // a full page reload (which is a Browser limitation, not a code bug).
    if (forceRestart) {
        try {
            await clearSpeechRecordingsForLesson(lesson.lessonId);
        } catch (e) {
            console.error(e);
        }
    } else {
        // Restore persisted recordings from IndexedDB into the in-memory Map.
        // This runs once during lesson load so that getAllSpeechRecordingsForLesson
        // can remain a pure in-memory read (instant) on the video processor's
        // critical path — no IDB access during video generation.
        try {
            await restoreRecordingsForLesson(lesson.lessonId);
        } catch (e) {
            console.warn('[LessonLoader] failed to restore recordings from IndexedDB', e);
        }
    }

    const player = getCurrentVideoPlayer();
    if (player) player.destroy();
    appStore.getState().resetForNewLesson();
    appStore.getState().resetLessonHistory();
    appStore.getState().resetLessonState();
    appStore.getState().setProgressPercent('0%');
    appStore.getState().setLessonStartTime(new Date().toISOString());
    appStore.getState().setRoleOther(lesson.roleOther || "");
    appStore.getState().setRoleUser(lesson.roleUser || "");
    appStore.getState().setUserRole(lesson.userRole || "");
    appStore.getState().setVideoRole(lesson.videoRole || "");

    // If navigating to a different lesson than the one whose step index
    // was persisted, reset to step 0 instead of resuming the old position.
    const prevStepLessonId = appStore.getState().currentStepIndexLessonId;
    if (lesson.lessonId !== prevStepLessonId) {
        appStore.setState({ currentStepIndex: 0, currentStepIndexLessonId: lesson.lessonId });
    }

    const configData = appStore.getState().configData;
    const course = configData?.courseName || "";
    const courseLevel = configData?.courseLevel || 'A0';
    const level = courseLevel ? ` (${courseLevel})` : "";
    const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
    const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
    const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

    const persistedIndex = forceRestart ? 0 : appStore.getState().currentStepIndex;
    const startIndex = (persistedIndex > 0 && persistedIndex < lesson.steps.length) ? persistedIndex : 0;

    appStore.setState({
        currentStepIndex: startIndex,
        lessonTitle: fullTitle,
        isLessonActive: true,
        stepsAnswered: startIndex
    });

    trackEvent('lesson_loaded', {
        lesson_id: lesson.lessonId,
        course_name: course,
        course_level: courseLevel,
        lesson_title: fullTitle,
        force_restart: forceRestart,
        start_index: startIndex,
        resumed: startIndex > 0,
        step_count: lesson.steps.length,
    });

    const stepDeps = getAnswerPipelineDeps();
    if (stepDeps) {
        // Mark this as a direct/restored load (page load, reload, or the signup
        // redirect). The success step uses this to reveal immediately instead of
        // waiting for a success clip that cannot autoplay without a user gesture.
        appStore.getState().setStepLoadedFromRestore(true);
        loadStep(lesson.steps[startIndex], lesson, null, stepDeps);
    }
}
