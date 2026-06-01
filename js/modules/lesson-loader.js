import { appStore, getAnswerPipelineDeps, getCurrentVideoPlayer } from './store.js';
import { clearSpeechRecordingsForLesson } from './storage.js';
import { loadStep } from '../components/step-loader.js';

export async function loadLessonContent(lesson, options = {}) {
    const { forceRestart = false } = options;

    try {
        await clearSpeechRecordingsForLesson(lesson.lessonId);
    } catch (e) {
        console.error(e);
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

    const configData = appStore.getState().configData;
    const course = configData?.courseName || "";
    const englishLevel = configData?.languageLevel || 'A0';
    const level = englishLevel ? ` (${englishLevel})` : "";
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

    const stepDeps = getAnswerPipelineDeps();
    if (stepDeps) {
        loadStep(lesson.steps[startIndex], lesson, null, stepDeps);
    }
}
