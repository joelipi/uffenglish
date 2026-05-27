// --- SMART LOG SWITCH ---
// This overrides console.log to prevent console clutter.
// To see logs for a specific module, change its value to true in the window.enabledLogs object below.
const originalConsoleLog = console.log;
window.enabledLogs = {
    whisper: false,
    recording: false,
    speech: false,
    api: false,
    'tanstack query': false,
    toggle: false,
    ai: false,
    analytics: false,
    ui: false,
    hesitation: false,
    success: false,
    scoring: false,
    video: false,
    router: false,
    pipeline: false,
    app: false,
    storage: false,
    gamification: false,
    all: false
};

console.log = (msg, ...args) => {
    if (typeof msg === 'string') {
        const match = msg.match(/^\[(.*?)\]/i);
        if (match) {
            const namespace = match[1].toLowerCase();
            // If the namespace is enabled, show the log
            if (window.enabledLogs[namespace]) {
                originalConsoleLog(msg, ...args);
                return;
            }
            // If it's a known namespace but disabled, keep it silent
            if (window.enabledLogs.hasOwnProperty(namespace)) return;
        }
    }
    // Fallback: If it's not namespaced, or not in our list, silence it by default
    // (To see everything, you can type window.enabledLogs.all = true in the console)
    if (window.enabledLogs.all) {
        originalConsoleLog(msg, ...args);
    }
};


import { navigateToHome, navigateToLogin } from './modules/navigation.js';
import { requestPersistentStorage, handleAuthClick } from './modules/lesson-init.js';
import { handleHint as handleHintImpl, submitAnswerPrecheck as submitAnswerPrecheckImpl, handleAnswer as handleAnswerImpl, showFeedbackAndProceed as showFeedbackAndProceedImpl } from './modules/an[...]
import { updateProgressBar as updateProgressBarImpl, loadNextStep as loadNextStepImpl, loadNextLesson as loadNextLessonImpl, showCompletionMessage as showCompletionMessageImpl, handleTutorChatSubm[...]

// -----------------------
import { clearSpeechRecordingsForLesson, updateSpeechRecording } from './modules/storage.js';

// Initialize the background NLP Worker via blob URL to bypass service worker caching

// --- UI & Media Components (Root Directory) ---
import { calculateCurrentStreak } from './modules/user-profile.js';

// --- Data & Configuration ---
import Strings from './data/strings.js';

// --- Decoupled Business Logic (Modules Directory) ---
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage, calculateFluencyScore } from './modules/scoring.js';
import { resolveCurrentLessonId, getNextStep, getUrlParamCaseInsensitive, resolveCurrentCourseId } from './modules/lessonRouting.js';
import { isUserLoggedIn, getUserProfile, signOut, queryClient, askEnglishTutor } from './modules/api.js';
import { saveCourseToUserProfile, saveLessonProgress, syncOfflineScores } from './modules/user-profile.js';
import {
    isIOS,
    warmUpSpeechCamStream,
    toggleSpeechRecognition,
    listeningState,
    initLocalVoiceAI
} from './modules/speech.js';
import {
    getCurrentStepIndex,
    processAnswerLogic,
    validateAnswerPrecheck
} from './modules/answers.js';

import { appStore } from './modules/store.js';


import { normalizeConfig } from './modules/config-normalizer.js';
import { loadVideoForStep } from './modules/video-loader.js';
window.appStore = appStore;
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import { buildFeedbackData, buildExplanationData } from './modules/feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from './components/feedback-renderer.js';
import { loadStep } from './components/step-loader.js';

import { idiomChecker } from './modules/idiom-checker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';

// END STOPGAPS — functions now imported from modules/lessonRouting.js

// CORE ANSWER HANDLING — extracted to modules/answer-pipeline.js
// Wrappers inject progression deps (loadNextStep, callLoadStep) to avoid circular imports.

const answerDeps = { loadNextStep, callLoadStep };

function handleHint(...args) { return handleHintImpl(...args); }
// Both wrappers must insert answerDeps at position 7 (_deps) when callers
// pass fewer args, because speech.js passes submitAnswerPrecheck as handleAnswer
// with 9 args (no _deps or courseId). Appending at the end shifts everything.
export async function submitAnswerPrecheck(...args) {
    if (args.length < 11) {
        return submitAnswerPrecheckImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return submitAnswerPrecheckImpl(...args, answerDeps);
}
export async function handleAnswer(...args) {
    if (args.length < 11) {
        return handleAnswerImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return handleAnswerImpl(...args, answerDeps);
}
function showFeedbackAndProceed(...args) { return showFeedbackAndProceedImpl(...args, answerDeps); }

// ADVANCE VIEWS CORE HOLY OF HOLIES 
// loadStep has been extracted to step-loader-web.js.
// This wrapper injects the app.js dependencies that the module needs.
function callLoadStep(step, lesson, fluencyData) {
    loadStep(step, lesson, fluencyData, {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint
    });
}

const progressionDeps = { callLoadStep, loadLessonContent };

function updateProgressBar() { return updateProgressBarImpl(); }
function loadNextStep(currentStep, fluencyData) { return loadNextStepImpl(currentStep, fluencyData, progressionDeps); }
async function loadNextLesson() { return loadNextLessonImpl(progressionDeps); }
function showCompletionMessage() { return showCompletionMessageImpl(); }
async function handleTutorChatSubmit(rawText) { return handleTutorChatSubmitImpl(rawText); }

async function initializeLesson(courseId = appStore.getState().courseId, configData = appStore.getState().configData, userData = appStore.getState().userData) {
    try {
        // Initialize the Tutor Chat UI and bind the submission logic
        appStore.getState().setTutorChatSubmitCallback(handleTutorChatSubmit);

        // 1. Gather browser-specific context — URL path takes precedence, then query params, then memory
        const urlParams = new URLSearchParams(window.location.search);
        const pathLessonMatch = window.location.pathname.match(/^\/course\/([^/]+)\/lesson\/([^/]+)/);
        const routerContext = {
            urlLessonId: pathLessonMatch?.[2] || getUrlParamCaseInsensitive(urlParams, 'lessonid'),
            storedLessonId: localStorage.getItem(`${courseId}_currentLessonId`),
            storedTimestamp: localStorage.getItem(`${courseId}_currentLessonTimestamp`)
        };

        // 2. Call the pure logic function
        const lessonId = resolveCurrentLessonId(configData, userData, courseId, routerContext);

        if (!configData || !configData.lessons) {
            throw new Error("No course configuration or lessons available.");
        }
        const lesson = configData.lessons.find(l => l.lessonId === lessonId);
        if (!lesson) {
            throw new Error(`Lesson '${lessonId}' not found in course configuration.`);
        }

         const englishLevel = configData?.languageLevel?.toUpperCase() || 'A0'; // Normalizing languageLevel

 console.log("Level System", englishLevel );
 // Proceed s safety functionalities etc verified closures. Decent logging timelines ; endpoint!.
    } catch error generic loop message slight performance adjustments decoded frameworks ideal endpoints clarified nuances hierarchy above standard expectations corrected devs...;} Designs layered comprehensions...`;}