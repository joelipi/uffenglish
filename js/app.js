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
    ai: true,
    analytics: false,
    ui: false,
    hesitation: false,
    success: false,
    scoring: false,
    video: false,
    router: false,
    pipeline: true,
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
import { handleHint as handleHintImpl, submitAnswerPrecheck as submitAnswerPrecheckImpl, handleAnswer as handleAnswerImpl, showFeedbackAndProceed as showFeedbackAndProceedImpl } from './modules/answer-pipeline.js';
import { updateProgressBar as updateProgressBarImpl, loadNextStep as loadNextStepImpl, loadNextLesson as loadNextLessonImpl, showCompletionMessage as showCompletionMessageImpl, handleTutorChatSubmit as handleTutorChatSubmitImpl } from './modules/lesson-progression.js';

// -----------------------
import { clearSpeechRecordingsForLesson, updateSpeechRecording } from './modules/storage.js';

// Initialize the background NLP Worker via blob URL to bypass service worker caching

// --- UI & Media Components (Root Directory) ---
import { SuccessLessonHandler } from './components/success-lesson.js';
import { pointLoss } from './components/point-loss-animation.js';
import { initMicAnimation } from './components/mic-animation.js';
import { calculateCurrentStreak } from './modules/user-profile.js';

// --- Data & Configuration ---
import Strings from './data/strings.js';

// --- Decoupled Business Logic (Modules Directory) ---
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage, calculateFluencyScore, logInteraction } from './modules/scoring.js';
import { resolveCurrentLessonId, getNextStep, getUrlParamCaseInsensitive, resolveCurrentCourseId } from './modules/lessonRouting.js';
import { isUserLoggedIn, getUserProfile, signOut, queryClient, askEnglishTutor } from './modules/api.js';
import { saveCourseToUserProfile, saveLessonProgress, syncOfflineScores } from './modules/user-profile.js';
import {
    isIOS,
    warmUpSpeechCamStream,
    startSpeechCamRecording,
    stopSpeechCamRecording,
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
import { State } from './modules/state.js';
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import { buildFeedbackData, buildExplanationData } from './modules/feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from './components/feedback-renderer.js';
import { loadStep } from './components/step-loader.js';

import { idiomChecker } from './modules/idiom-checker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';

// END STOPGAPS — functions now imported from modules/lessonRouting.js

// Speaking Score Logic ---
window.addEventListener('transcriptRejected', (e) => {
    const cue = e.detail?.cue || "unknown_cue";
    const transcript = e.detail?.transcript || "unknown_transcript";
    logInteraction(cue, transcript, "rej_usr", "User rejected Whisper transcription", null, State.interactionLog);

    // Deduct 20 points, floor at 0
    appStore.getState().deductSpeakingScore(20);
    appStore.getState().incrementWhisperRejections();
    // Show point loss animation explicitly on the score span (subscription handles the text update)
    if (document.getElementById('pronunciationScore')) {
        pointLoss.show(document.getElementById('pronunciationScore'), 20);
    }
});

window.addEventListener('preflightRejected', () => {
    //   FIX: Use the correct Zustand action for the Speaking Score
    appStore.getState().deductSpeakingScore(10);
    appStore.getState().incrementWhisperRejections();
    // Show point loss animation (subscription handles the text update)
    if (document.getElementById('pronunciationScore')) {
        pointLoss.show(document.getElementById('pronunciationScore'), 10);
    }
});

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

        // 3. Execute Browser Side-Effects — strip stale query params from the URL
        // so a page refresh doesn't re-load an outdated course/lesson from the query string.
        // Only runs when a lessonId was resolved (from path or query string).
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

        await saveLessonProgress(courseId, lessonId, userData, { updateUserMeta: false, incrementCount: false });

        appStore.setState({ currentLessonIndex: configData.lessons.findIndex(l => l.lessonId === lessonId) });

        if (window.preloadLessonAssets) {
            const constructFirebaseUrl = (slug) => `https://r2.ultrafastfluency.com/assets/videos/${slug}.mp4`;
            await window.preloadLessonAssets(lesson, constructFirebaseUrl);
        }

        loadLessonContent(lesson, configData);
    } catch (error) {
        console.error("initializeLesson error:", error);
        appStore.getState().setIsLoaded(true);
        appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error', userData?.native_language));
    }
}

async function loadLessonContent(lesson, configData) {
    try {
        await clearSpeechRecordingsForLesson(lesson.lessonId);
    } catch (e) {
        console.error(e);
    }

    if (State.player) State.player.destroy();
    State.resetForNewLesson();
    State.lessonStartTime = new Date().toISOString();
    State.roleOther = lesson.roleOther || "";
    State.roleUser = lesson.roleUser || "";
    State.userRole = lesson.userRole || "";
    State.videoRole = lesson.videoRole || "";

    // No manual updateCurrentScoreDisplay or updateActivityDisplay call needed: they are reactively handled by React.
    updateProgressBar(lesson);

    // --- TITLE LOGIC ---
    const course = configData?.courseName || "";
    const englishLevel = configData?.languageLevel || 'A0';
    const level = englishLevel ? ` (${englishLevel})` : "";
    const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
    const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
    const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

    {
        const ivpWrapper = document.querySelector('.ivp-main-wrapper');
        if (ivpWrapper) ivpWrapper.classList.remove('d-none');
        const footer = document.querySelector('footer');
        if (footer) footer.classList.remove("d-none");
        document.body.classList.remove('bg-dark');
        if (document.getElementById('media-viewport')) document.getElementById('media-viewport').classList.remove('d-none');
        const lessonHeader = document.getElementById('lesson-header');
        if (lessonHeader) {
            lessonHeader.style.display = 'block';
            lessonHeader.classList.remove('lesson-header');
            void lessonHeader.offsetWidth;
            lessonHeader.classList.add('lesson-header');
        }
        const titles = document.getElementsByClassName('lesson-title');
        for (let i = 0; i < titles.length; i++) {
            if (titles[i]) {
                titles[i].textContent = fullTitle;
            }
        }
    }

    const userData = queryClient.getQueryData(['user', 'profile']);

    // --- MISSION LOGIC ---
    // The mission is lesson-wide and should stay the same throughout.
    const lang = userData?.native_language;
    callLoadStep(lesson.steps[appStore.getState().currentStepIndex], lesson, null);
}

// INITIALIZE APP 
async function initializeApp() {
    // Initialize reactive UI subscriptions first so the UI responds to store changes 
    // from the moment any state is set during initialization.

    const isDemoMode = new URLSearchParams(window.location.search).has('demo');
    appStore.getState().setDemoMode(isDemoMode);

    try {
        requestPersistentStorage();
        const isLoggedIn = await isUserLoggedIn();
        appStore.getState().setIsLoggedIn(isLoggedIn);
        const userData = await getUserProfile();
        appStore.getState().setCourseData({ userData });

        if (!isLoggedIn) {
            console.warn('User not authenticated. Proceeding as guest.');
            appStore.getState().setGuestModalOpen(true);
        }

        State.initializeUserMetrics(appStore.getState().userData, calculateCurrentStreak);
        initMicAnimation();
        // Immediately trigger offline score sync if needed
        syncOfflineScores(appStore.getState().userData);

        // 1. Gather context — URL path takes precedence, then query params, then memory
        const urlParamsApp = new URLSearchParams(window.location.search);
        const pathCourseMatch = window.location.pathname.match(/^\/course\/([^/]+)\/lesson\/([^/]+)/);
        const courseContext = {
            urlCourseId: pathCourseMatch?.[1] || getUrlParamCaseInsensitive(urlParamsApp, 'courseid'),
            storedCourseId: localStorage.getItem('currentCourse'),
            wpCourseId: appStore.getState().userData?.current_course || null
        };
        // 2. Pure function evaluation
        const courseId = resolveCurrentCourseId(appStore.getState().userData, courseContext);
        appStore.getState().setCourseData({ courseId });
        // 3. Side effects
        localStorage.setItem('currentCourse', appStore.getState().courseId);
        if (appStore.getState().userData && typeof appStore.getState().userData === 'object') {
            await saveCourseToUserProfile(appStore.getState().courseId, appStore.getState().userData);
        }

        // --- FETCH CONFIG AND SET LANGUAGE LEVEL ---
        const response = await fetch(`/js/config/${appStore.getState().courseId}.json`);
        const configData = await response.json();

        // Pull level directly from the JSON field (e.g., "B1")
        const englishLevel = configData.languageLevel || 'A0';
        console.log(`Course Level initialized to: ${englishLevel}`);

        appStore.getState().setCourseData({ configData, englishLevel });

        normalizeConfig(appStore.getState().configData, appStore.getState().userData?.native_language);

        State.successHandler = new SuccessLessonHandler({
            configData: appStore.getState().configData,
            loadLessonContent,
            calculateAverage,
            playSound: Media.playSound,
            loadNextLesson,
            updateState: (newState) => {
                // Route reactive metrics to the Zustand store; all other keys go to State as before 
                const reactiveKeys = ['listeningScore', 'speakingScore', 'incorrectAttempts', 'dayCount', 'currentStreak'];
                const storeUpdates = {};
                const stateUpdates = {};

                Object.entries(newState).forEach(([key, value]) => {
                    if (reactiveKeys.includes(key)) {
                        storeUpdates[key] = value;
                    } else {
                        stateUpdates[key] = value;
                    }
                });
                if (Object.keys(storeUpdates).length > 0) {
                    appStore.setState(storeUpdates);
                }
                if (Object.keys(stateUpdates).length > 0) {
                    Object.assign(State, stateUpdates);
                }
            },
            uiElements: {
                statsContainer: document.getElementById('react-root-stats'),
                progressbar: document.getElementById('progress'),
                progressBarFill: document.getElementById('progress'),
                speechTextHere: document.getElementById('chat-window-container'),
                chatMessageList: document.getElementById('chat-message-list')
            }
        });

        console.log('[app] SuccessLessonHandler initialized', {
            currentLessonIndex: appStore.getState().currentLessonIndex,
            lessonsLoaded: appStore.getState().configData?.lessons?.length,
            fluencyScore: appStore.getState().fluencyScore,
            listeningScore: appStore.getState().listeningScore,
            speakingScore: appStore.getState().speakingScore
        });

        //   CRITICAL TO PREVENT RAM OVERLOAD: Render the UI and Video FIRST
        await initializeLesson();

        //   CRITICAL TO PREVENT RAM OVERLOAD: Boot Whisper and NLP background models IN SEQUENCE
        // Note: Deferred to React App shell component.

    } catch (error) {
        console.error("Initialization error:", error);
        appStore.getState().setIsLoaded(true);
        appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error', appStore.getState().userData?.native_language));
    }
}

// Note: loadLocalModelsInBackground has been moved to the React App shell.

// HYBRID ROUTER: Listen for React Router navigation events
// Remove this once initializeApp and initializeLesson are fully migrated to React.
window.addEventListener('hybridRouteChange', async (e) => {
    const { courseId, lessonId } = e.detail;
    console.log(`[HybridRouter] Route change received. Course: ${courseId}, Lesson: ${lessonId}`);

    if (!appStore.getState().configData) {
        console.warn('[HybridRouter] Config not loaded yet — waiting for initializeApp to complete.');
        return;
    }

    appStore.setState({ activeLessonId: lessonId });
    await initializeLesson(courseId, appStore.getState().configData, appStore.getState().userData);
});

// Check if the page is already loaded before adding the listener.
// This prevents the "silent hang" race condition.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}