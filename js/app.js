// --- SMART LOG SWITCH ---
// This overrides console.log to prevent console clutter.
// To see logs for a specific module, change its value to true in the window.enabledLogs object below.
const originalConsoleLog = console.log;
window.enabledLogs = {
    whisper: false,
    recording: false,
    speech: false,
    api: false,
    tanstack: false,
    toggle: false,
    ai: false,
    analytics: false,
    ui: false,
    hesitation: true,
    success: true,
    gamification: false,
    all: true
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
    isLastAiStepInLesson,
    processAnswerLogic,
    validateAnswerPrecheck
} from './modules/answers.js';

import { appStore } from './modules/store.js';


import { normalizeConfig } from './modules/config-normalizer.js';
import { loadVideoForStep } from './modules/video-loader.js';
//window.appStore = appStore; // <-- ADD THIS TEMPORARY LINE FOR TESTING
import { State } from './modules/state.js';
import { getLocalizedTranslation } from './modules/utils.js';
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import { buildFeedbackData, buildExplanationData } from './modules/feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from './components/feedback-renderer.js';
import { loadStep } from './components/step-loader.js';
import {
    DOM,
    flashElement,
    disableAllButtons,
    clearChatInterface,
    renderUserResponse,
    renderAIAnalysisLoading,
    renderAIFeedback,
    safeRenderChatInterface,
    showHintsAndScroll,
    hideHints,
    clearMicStatusAndHideMedia,
    setMicStatusText,
    ensureWebcamPreview,
    hideWebcamPreview,
    removeWebcamPreview,
    clearPlaybackVideo,
    prepareMediaUI,
    showPlaybackVideo,
    initTutorChatUI,
    showTutorChatInput,
    hideTutorChatInput,
    getChatHistoryContext,
    renderTutorMessage,
    showContinueButton,
    hideContinueButton,
    renderFallbackContinueButton,
    toggleScoresAndHearts,
    setProgressBarWidth,
    showMessageInStepsContainer,
    showInitializationErrorMessage,
    setupLessonUI,
    generateHangmanHint,
    showGuestLoginModal,
    initUISubscriptions,
    handlecueUI,
    handleIncueUI,
    updateChatHeaderScores,
    hidePreloader,
    removeAILoadingStatus,
    renderHangmanHint,
    showMicWarning,
    showAnswerError,
    resetMicStatusWithStep,
    resetMissionText,
    bindAuthMenuUI,
    initMissionToggle
} from './components/ui.js';
import { idiomChecker } from './modules/idiom-checker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';

//STOPGAP CODE WHILE MIGRATING
// TEMP: duplicate of resolveCurrentLessonId in modules/lessonRouting.js
// Remove once callers at lines 239 and 724 are migrated to React.
function resolveCurrentLessonId(configData, userData, courseId, context = {}) {
    if (!configData || typeof configData !== 'object') {
        throw new Error('resolveCurrentLessonId: Invalid or missing course configuration.');
    }
    const { urlLessonId, persistedLessonId, storedLessonId, storedTimestamp } = context;
    if (urlLessonId) return urlLessonId;
    if (persistedLessonId && typeof persistedLessonId === 'string' && persistedLessonId.trim() !== '') {
        const lessonExists = configData.lessons?.some(lesson => lesson.lessonId === persistedLessonId);
        if (lessonExists) return persistedLessonId;
    }
    let wpLessonId = null, wpTimestamp = null;
    if (userData) {
        wpLessonId = userData[`${courseId}_current_lesson`] ?? null;
        const ts = userData[`${courseId}_lesson_timestamp`];
        wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
    }
    const lsTs = storedTimestamp && !isNaN(new Date(storedTimestamp).getTime()) ? new Date(storedTimestamp) : null;
    const sources = [];
    if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
    if (storedLessonId && lsTs) sources.push({ lessonId: storedLessonId, timestamp: lsTs });
    if (sources.length === 1) return sources[0].lessonId;
    if (sources.length > 1) { sources.sort((a, b) => b.timestamp - a.timestamp); return sources[0].lessonId; }
    if (configData.lessons?.length > 0 && configData.lessons[0].lessonId) return configData.lessons[0].lessonId;
    throw new Error('resolveCurrentLessonId: No lessons found in the course configuration.');
}

// TEMP: duplicate of getNextStep in modules/lessonRouting.js
// Remove once caller at line 599 is migrated to React.
function getNextStep(currentStep, configData, currentLessonIndex) {
    if (!configData?.lessons || currentLessonIndex >= configData.lessons.length) return null;
    const currentLesson = configData.lessons[currentLessonIndex];
    const currentIndex = currentLesson.steps.findIndex(q => q.step === currentStep.step && q.cue === currentStep.cue);
    if (currentIndex === -1) return currentLesson.steps[0];
    if (currentIndex >= currentLesson.steps.length - 1) return null;
    return currentLesson.steps[currentIndex + 1];
}

function getUrlParamCaseInsensitive(urlParams, paramName) {
    const target = paramName.toLowerCase();
    for (const [key, value] of urlParams.entries()) {
        if (key.toLowerCase() === target) {
            return value;
        }
    }
    return null;
}

// TEMP: duplicate of resolveCurrentCourseId in modules/lessonRouting.js
// Remove this once the caller at line 844 is migrated to React.
function resolveCurrentCourseId(userData, context = {}) {
    const { urlCourseId, wpCourseId, storedCourseId } = context;

    if (urlCourseId) return urlCourseId;

    if (userData && typeof userData === 'object') {
        const fromProfile = wpCourseId || userData.current_course || null;
        if (fromProfile) return fromProfile;
    }

    if (storedCourseId) return storedCourseId;

    return 'tutorial';
}

// END STOPGAPS

// Speaking Score Logic ---
window.addEventListener('transcriptRejected', (e) => {
    const cue = e.detail?.cue || "unknown_cue";
    const transcript = e.detail?.transcript || "unknown_transcript";
    logInteraction(cue, transcript, "rej_usr", "User rejected Whisper transcription", null, State.interactionLog);

    // Deduct 20 points, floor at 0
    appStore.getState().deductSpeakingScore(20);
    appStore.getState().incrementWhisperRejections();
    // Show point loss animation explicitly on the score span (subscription handles the text update)
    if (DOM.pronunciationScore) {
        pointLoss.show(DOM.pronunciationScore, 20);
    }
});

window.addEventListener('preflightRejected', () => {
    //   FIX: Use the correct Zustand action for the Speaking Score
    appStore.getState().deductSpeakingScore(10);
    appStore.getState().incrementWhisperRejections();
    // Show point loss animation (subscription handles the text update)
    if (DOM.pronunciationScore) {
        pointLoss.show(DOM.pronunciationScore, 10);
    }
});

// CORE ANSWER HANDLING
function handleHint(stepIndex) {
    showHintsAndScroll();
}

export async function submitAnswerPrecheck(val, cue, stepData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, stepData, englishLevel, userData, appStore.getState().cuesGiven
    );

    if (!isValid) {
        logInteraction(cue, val, "rej_pre", warningMessage, null, State.interactionLog);
        if (!State.isTextMode) {
            //   FIX: Now correctly deducts from the Speaking Score instead of the Listening Score
            appStore.getState().deductSpeakingScore(10);
            // Show point loss animation (subscription handles the text update)
            if (DOM.pronunciationScore) {
                pointLoss.show(DOM.pronunciationScore, 10);
            }
        } else {
            console.log('[submitAnswerPrecheck] Text mode: skipping speaking score deduction');
        }

        // REFACTORED: Moved raw HTML injection to UI module
        showMicWarning(warningMessage);

        if (State.isTextMode) {
            showAnswerError(warningMessage);
            clearPlaybackVideo();
            removeWebcamPreview();
            const inputField = document.getElementById('answer-input-field');
            if (inputField) {
                inputField.disabled = false;
                inputField.classList.remove('disabled');
                inputField.focus();
                if (DOM.answerInputArea) flashElement(DOM.answerInputArea);
            }
        }

        // Update the recording anyway so the final video has subtitles for this incorrect attempt!
        const currentLessonId = appStore.getState().activeLessonId
            || (configData?.lessons?.[appStore.getState().currentLessonIndex]?.lessonId)
            || 'unknown_lesson';
        const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);
        await updateSpeechRecording(currentLessonId, stepIndex, {
            userResponse: val,
            cue: cue,
            isTextMode: State.isTextMode,
            duration: State.isTextMode ? 3 : null
        });

        // Apply speech results to the InteractiveVideoPlayer if present
        if (stepData.stepType === "closedResponse" && State.player && State.player.controller && State.player.controller.applySpeechResult) {
            const userWords = val.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/);
            const correctIndices = [];
            const wrongIndices = [];

            // basic comparison logic matching exact tokens
            State.player.controller.tokens.forEach((token, idx) => {
                if (State.player.controller.punctuationMap.get(idx)) return;
                const cleanToken = token.toLowerCase().replace(/[^\w\s']/g, '');
                if (userWords.includes(cleanToken)) {
                    correctIndices.push(idx);
                } else {
                    wrongIndices.push(idx);
                }
            });
            State.player.controller.applySpeechResult(correctIndices, wrongIndices);
        }

        if (btn) btn.disabled = false;
        return;
    }

    // Apply exact success to IVP
    if (stepData.stepType === "closedResponse" && State.player && State.player.controller && State.player.controller.applySpeechResult) {
        const correctIndices = State.player.controller.tokens.map((_, i) => i);
        State.player.controller.applySpeechResult(correctIndices, []);
    }

    await handleAnswer(val, cue, stepData, btn, explanation, translation, stats, userData, configData, courseId);
}

function resetButtonState(button) {
    if (button) {
        button.disabled = false;
        button.classList.remove('disabled');
        button.style.display = "inline-block";

        if (State.isTextMode) {
            button.innerHTML = '<i class="bi bi-send-fill"></i>';
            // Re-enable and clear the input field
            const inputField = document.getElementById('answer-input-field');
            if (inputField) {
                inputField.value = '';
                inputField.disabled = false;
                inputField.classList.remove('disabled');
                setTimeout(() => inputField.focus(), 100);
            }
        } else {
            button.innerHTML = '<i class="bi bi-mic-fill"></i>';
        }

        button.classList.remove('btn-danger', 'btn-danger-recording');
    }
}

// buildStatsBlocks has been extracted to feedback-builder.js (data) + feedback-renderer-web.js (HTML)

export async function handleAnswer(userResponse, cue, stepData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    // Show the playback video immediately as the first chat message while processing
    if (!State.isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        showPlaybackVideo();
    }

    let speechAnalytics = null;
    let cleanWordCount = 0;
    const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);

    try {
        const currentLessonId = (configData && configData.lessons && configData.lessons[appStore.getState().currentLessonIndex]) ? configData.lessons[appStore.getState().currentLessonIndex].lessonId : 'unknown_lesson';

        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            cleanWordCount = userResponse.replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean).length;

            if (stats && stats.netDuration !== null) {
                speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, courseId ? courseId.substring(0, 2).toUpperCase() : 'A1', stepData.stepType);
                if (speechAnalytics && stats.hesitation !== undefined) {
                    speechAnalytics.hesitation = stats.hesitation;
                }
            } else {
                speechAnalytics = {}; // fallback
            }

            if (State.isTextMode) {
                if (speechAnalytics) {
                    speechAnalytics.pronunciationScore = null;
                    speechAnalytics.flowScore = null;
                    speechAnalytics.wpm = 0;
                    speechAnalytics.pauseCount = 0;
                    speechAnalytics.netDuration = 3;
                }
                console.log('[handleAnswer] Text mode: overridden speech metrics for scoring');
            }

            await updateSpeechRecording(currentLessonId, stepIndex, {
                userResponse,
                cue,
                wpm: State.isTextMode ? 0 : (speechAnalytics?.wpm || 0),
                pauseCount: State.isTextMode ? 0 : (speechAnalytics?.pauseCount || 0),
                complexityScore: speechAnalytics?.complexityScore || 100,
                isTextMode: State.isTextMode,
                duration: State.isTextMode ? 3 : (speechAnalytics?.netDuration || null)
            });
            console.log("Successfully updated speech recording with answers");
        }
    } catch (e) {
        console.error("Error updating speech recording with answers", e);
    }

    Media.pauseVideoIfPlaying();
    window.isMicActive = false; // Release the interaction lock
    clearMicStatusAndHideMedia();
    hideHints();

    let immediateStatsHtmlArr = [];
    let fluencyBubbleHTML = null; // extracted overall-fluency bubble rendered last
    if (button) {
        disableAllButtons(button.parentElement);
    }

    try {
        const englishLevel = configData?.languageLevel || 'A0';
        const lesson = (configData && configData.lessons) ? configData.lessons[appStore.getState().currentLessonIndex] : null;

        if (!lesson) {
            throw new Error("configData or lessons missing in handleAnswer");
        }

        let result = null;
        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            result = await processAnswerLogic({
                userResponse, cue, stepData,
                lesson: lesson,
                english_level: englishLevel,
                userData: userData,
                cuesGiven: appStore.getState().cuesGiven,
                apiRoot: State.apiRoot
            });

            if (!result) {
                console.warn("  No result from local NLP   no Gemini fallback active. Treating as passed.");
                result = { isCorrect: true, normalizeduserResponse: userResponse, normalizedcue: cue, explanation: explanation, intentLabels: [] };
            }
        }

        const isCorrect = result ? result.isCorrect : true;
        let grammarCorrection = null;

        if (result && result.explanations) {
            const diffObj = result.explanations.find(e => e.type === 'grammar_diff');
            if (diffObj && diffObj.correction) grammarCorrection = diffObj.correction;
        }

        let status = isCorrect ? "ok" : "inc";
        let pragmaticDetails = result?.intentLabels?.length > 0 ? result.intentLabels : null;
        logInteraction(cue, userResponse, status, pragmaticDetails, grammarCorrection, State.interactionLog);

        // Log idioms and pragmatics to the global state arrays if they exist in the result object
        if (result?.foundIdioms?.length > 0) {
            State.recognizedIdioms.push(...result.foundIdioms);
        }
        if (result?.intentLabels?.length > 0) {
            State.pragmaticFlags.push(...result.intentLabels);
        }

        const { listeningScore, speakingScore, incorrectAttempts, whisperRejections } = appStore.getState();

        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            const attemptNumber = incorrectAttempts + 1; // 1-based attempt index
            let grammarErrorScore = 100;

            if (result && result.explanations) {
                const diffObj = result.explanations.find(e => e.type === 'grammar_diff');
                if (diffObj) {
                    grammarErrorScore = 0;
                }
            }

            // Calculate granular scores
            const scoreData = calculateFluencyScore({
                pronunciationScore: speakingScore,
                listeningScore: listeningScore,
                wpm: speechAnalytics?.wpm || 0,
                pauseCount: stats.pauseCount || 0,
                hesitation: speechAnalytics?.hesitation || 0,
                wordCount: cleanWordCount,
                idiomCount: speechAnalytics?.foundIdioms ? speechAnalytics.foundIdioms.length : 0,
                cefrLevel: englishLevel,
                grammarErrorScore: grammarErrorScore,
                complexityScore: speechAnalytics?.complexityScore || 100,
                labels: result && result.intentLabels ? result.intentLabels : [],
                attemptNumber: attemptNumber,
                isTextMode: State.isTextMode
            });

            appStore.getState().setFluencyMetrics({
                fluencyScore: scoreData.fluencyScore,
                flowScore: scoreData.subScores.flow,
                vocabularyScore: scoreData.subScores.vocabulary,
                grammarScore: scoreData.subScores.grammar,
                formalityScore: scoreData.subScores.formality,
                nativeLikeScore: scoreData.subScores.nativeLike,
                understandingScore: scoreData.subScores.understanding
            });

            const feedbackData = buildFeedbackData({
                scoreData, speechAnalytics, result, stepData,
                lang: userData?.native_language, englishLevel,
                attemptNumber: incorrectAttempts + 1,
                repetitionCount: State.videoPlays,
                whisperRejections: whisperRejections
            });

            // Update header scoreboard immediately   scores are ready
            updateChatHeaderScores(feedbackData);

            const allFeedbackHTML = renderFeedbackToHTML(feedbackData);

            // The fluency (overall) section is always first (unshifted in buildFeedbackData for 'ai').
            // Split it out so it renders last   just before praise/try-again.
            if (feedbackData.sections.length > 0 && feedbackData.sections[0].isOverall) {
                fluencyBubbleHTML = allFeedbackHTML[0];
                immediateStatsHtmlArr = allFeedbackHTML.slice(1);
            } else {
                immediateStatsHtmlArr = allFeedbackHTML;
            }
        }

        // --- SILENT RETRY FLOW FOR SPEECH ---
        if (!isCorrect && stepData.stepType === "closedResponse" && incorrectAttempts < 2) {
            // Use silent mode for handleIncueUI - show feedback but skip some UI sounds
            handleIncueUI(stepIndex, stepData, button, cue, userResponse, result.explanations || explanation, result.normalizeduserResponse, result.normalizedcue, stepData.step, true, userData, configData);
            clearPlaybackVideo();
            clearChatInterface();
            removeWebcamPreview();

            // Speech Hangman Logic: Show hint and stay on step
            const hangmanHTML = generateHangmanHint(userResponse, cue);

            // REFACTORED: Delegate DOM query and injection to UI module
            renderHangmanHint(hangmanHTML);

            showHintsAndScroll();
            // Restart video player if available
            prepareMediaUI();

            const player = State.player || window.currentVideoPlayer;
            if (player) {
                if (player.video) {
                    player.video.currentTime = 0;
                }
                // Small delay to ensure DOM update (unhiding) is processed before play()
                setTimeout(() => {
                    if (player.play) {
                        player.play().catch(e => console.warn("Video play failed:", e));
                    } else if (player.video) {
                        player.video.play().catch(e => console.warn("Video play failed:", e));
                    }
                }, 50);
            }

            // REFACTORED: Removed document.createElement and raw class assignments
            resetMicStatusWithStep(stepData.step);
            resetButtonState(button);
            return; // EXIT EARLY: No chat bubbles, no proceed
        }

        // --- STANDARD UI RENDERING LOGIC (POST-EVALUATION) ---
        if (stepData.stepType === "openResponse" && userResponse && DOM.speechText) {
            const lang = userData?.native_language;
            const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
            const translationStr = (localizedTrans && lang && lang !== 'en') ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>` : "";

            renderAIFeedback([`<strong>${cue}${translationStr}</strong>`]);
            renderUserResponse(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        } else if (stepData.stepType === "closedResponse" && userResponse && DOM.speechText) {
            renderUserResponse(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        }

        // --- WEB ADAPTER: Translate Pure Data to Web UI ---
        const explanationData = buildExplanationData(result?.explanations, explanation);
        const webFormattedExplanations = renderExplanationsToHTML(explanationData);

        // Show the tutor chat input once the evaluation completes
        showTutorChatInput();

        if (isCorrect) {
            if (stepData.stepType === "openResponse") {
                appStore.setState({ cuesGiven: [...appStore.getState().cuesGiven, result.normalizeduserResponse] });
                if (result.cefrLevelDeduction > 0) {
                    appStore.getState().deductListeningScore(result.cefrLevelDeduction);
                }
            }
            // Pass the webFormattedExplanations instead of result.explanations
            // If the user gets it correct on AI, webFormattedExplanations may be empty.
            // We should ensure the new score bubbles that were added to immediateStatsHtmlArr are preserved.
            // Actually, handlecueUI uses `explanation` directly. 
            // In handleAnswer we did: `renderAIFeedback(immediateStatsHtmlArr);`
            // and we do NOT need to pass them to handlecueUI unless we want to replace `explanation`.
            handlecueUI(stepIndex, stepData, button, cue, webFormattedExplanations, translation, userResponse, result ? result.cefrLevel : undefined, result ? result.cefrLevelDeduction : undefined, userData, configData, fluencyBubbleHTML);
            showFeedbackAndProceed(stepData, isCorrect, userData, configData);
        } else {
            // Pass the webFormattedExplanations instead of result.explanations
            handleIncueUI(stepIndex, stepData, button, cue, userResponse, webFormattedExplanations, result ? result.normalizeduserResponse : "", result ? result.normalizedcue : "", stepData.step, false, userData, configData, fluencyBubbleHTML);
            showFeedbackAndProceed(stepData, isCorrect, userData, configData);
        }

    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncueUI(stepIndex, stepData, button, cue, userResponse, explanation, "", "", translation, false, userData, configData);
        showFeedbackAndProceed(stepData, false, userData, configData);
    }
}

// handlecueUI and handleIncueUI have been extracted to components/ui.js

function showFeedbackAndProceed(stepData, isCorrect) {
    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) State.stepCount++;
    try {
        hideHints();
        const continueButton = showContinueButton(stepData.stepType === "lessonIntro", () => {
            Media.pauseVideoIfPlaying(); // Stop any rogue background video sounds immediately
            if (stepData.stepType === "lessonIntro") {
                const initializeMedia = async () => {
                    await Media.enableAudioSystem();
                    await warmUpSpeechCamStream();
                };
                initializeMedia();
            }
            hideContinueButton();
            if (stepData.stepType === "lessonIntro") {
                setTimeout(() => loadNextStep(stepData), 2000);
            } else {
                if (isCorrect || appStore.getState().incorrectAttempts > 2) loadNextStep(stepData);
                else {
                    const stepIndex = getCurrentStepIndex(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
                    window.__currentStepIndex = stepIndex;
                    callLoadStep(appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].steps[stepIndex], appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
                }
            }
        });

        if (isCorrect || appStore.getState().incorrectAttempts > 2) {
            const nextStep = getNextStep(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
            if (nextStep && nextStep.videoUrl) {
                const videoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${nextStep.videoUrl}.mp4?alt=media`;
                Media.preloader.preloadOnly(videoUrl);
            }
        }
    } catch (error) {
        renderFallbackContinueButton(Strings.get('btn_continue', appStore.getState().userData?.native_language) || 'Continue', () => {
            if (isCorrect || appStore.getState().incorrectAttempts > 2) loadNextStep(stepData);
            else callLoadStep(stepData, appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
        });
    }
}

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

function updateProgressBar() {
    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const totalSteps = currentLesson.steps.length;
    let currentSteps = State.stepsAnswered++;
    const finalProgress = Math.min(Math.max((currentSteps / totalSteps) * 100, 10), 90);
    setProgressBarWidth(`${finalProgress}%`);
}

function loadNextStep(currentStep, fluencyData) {
    updateProgressBar();
    toggleScoresAndHearts(false);
    State.resetForNextStep();

    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];

    appStore.setState({ currentStepIndex: appStore.getState().currentStepIndex + 1 });
    if (appStore.getState().currentStepIndex < currentLesson.steps.length) {
        callLoadStep(currentLesson.steps[appStore.getState().currentStepIndex], currentLesson, fluencyData);
    } else {
        if (currentLesson.nextLessonId) loadNextLesson();
        else showCompletionMessage();
    }
}

function showCompletionMessage() {
    showMessageInStepsContainer(Strings.get('msg_lesson_complete_all', appStore.getState().userData?.native_language));
}

async function loadNextLesson() {
    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData).then(progressResult => {
            if (progressResult.dayCountIncremented) {
                // Update the store; subscription handles the display
                appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
            }
        });

        setTimeout(async () => {
            const nextLessonIndex = appStore.getState().configData.lessons.findIndex(l => l.lessonId === nextLessonId);
            if (nextLessonIndex !== -1) {
                appStore.setState({ currentLessonIndex: nextLessonIndex });
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonId`, nextLessonId);
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonTimestamp`, new Date().toISOString());
                setProgressBarWidth("100%");
                State.stepsAnswered = 0;
                appStore.setState({ currentStepIndex: 0 });
                loadLessonContent(appStore.getState().configData.lessons[nextLessonIndex]);
            } else showCompletionMessage();
        }, 1200);
    } else {
        Media.playSound('lesson-complete-sound');
        showCompletionMessage();
    }
}

// INITIALIZATION/LESSON SETUP
async function handleTutorChatSubmit(rawText) {
    if (!rawText || !rawText.trim()) return;
    const wordCount = rawText.trim().split(/\s+/).length;
    appStore.getState().incrementUserTutorStats(wordCount);

    // Show user's message
    renderTutorMessage(rawText, true);

    // Show loading
    renderAIAnalysisLoading(Strings.get('ai_thinking', appStore.getState().userData?.native_language));

    // Get context and send to API
    const context = getChatHistoryContext();
    try {
        const aiResponse = await askEnglishTutor(context, rawText);
        const aiWordCount = aiResponse.trim().split(/\s+/).length;
        appStore.getState().incrementAiTutorStats(aiWordCount);

        // Remove the loading indicator
        removeAILoadingStatus();

        // Show AI response
        renderTutorMessage(aiResponse, false);
    } catch (error) {
        console.error('[app] Error in askEnglishTutor:', error);
        removeAILoadingStatus();
    }
}

async function initializeLesson(courseId = appStore.getState().courseId, configData = appStore.getState().configData, userData = appStore.getState().userData) {
    try {
        // Initialize the Tutor Chat UI and bind the submission logic
        initTutorChatUI(handleTutorChatSubmit);

        // 1. Gather browser-specific context
        const urlParams = new URLSearchParams(window.location.search);
        const routerContext = {
            urlLessonId: getUrlParamCaseInsensitive(urlParams, 'lessonid'),
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

        // 3. Execute Browser Side-Effects (Previously hidden inside lesson-router.js)
        if (routerContext.urlLessonId) {
            const url = new URL(window.location.href);
            const keysToDelete = [];
            for (const key of url.searchParams.keys()) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'lessonid' || lowerKey === 'course' || lowerKey === 'courseid') {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => url.searchParams.delete(key));
            window.history.replaceState({}, document.title, url.toString());
        }

        await saveLessonProgress(courseId, lessonId, userData, { updateUserMeta: false, incrementCount: false });

        appStore.setState({ currentLessonIndex: configData.lessons.findIndex(l => l.lessonId === lessonId) });

        if (window.preloadLessonAssets) {
            const constructFirebaseUrl = (slug) => `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${slug}.mp4?alt=media`;
            await window.preloadLessonAssets(lesson, constructFirebaseUrl);
        }

        loadLessonContent(lesson, configData);
    } catch (error) {
        console.error("initializeLesson error:", error);
        hidePreloader(); // REFACTORED
        showInitializationErrorMessage(Strings.get('lesson_load_error', userData?.native_language));
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

    setupLessonUI(fullTitle);

    const userData = queryClient.getQueryData(['user', 'profile']);

    // --- MISSION LOGIC ---
    // The mission is lesson-wide and should stay the same throughout.
    const lang = userData?.native_language;
    const missionText = getLocalizedTranslation(lesson.mission, lang);
    const settingText = getLocalizedTranslation(lesson.setting, lang);
    const roleUserText = getLocalizedTranslation(lesson.roleUser, lang);
    const roleOtherText = getLocalizedTranslation(lesson.roleOther, lang);
    resetMissionText(missionText, settingText, roleUserText, roleOtherText);

    callLoadStep(lesson.steps[appStore.getState().currentStepIndex], lesson, null);
}

async function handleAuthClick(e) {
    e.preventDefault();
    const isLoggedIn = await isUserLoggedIn();
    if (isLoggedIn) {
        if (confirm('Are you sure you want to sign out?')) {
            await signOut();
            navigateToHome(); // REFACTORED
        }
    } else {
        const currentUrl = window.location.pathname + window.location.search;
        navigateToLogin(currentUrl); // REFACTORED
    }
}

function setupAuthMenu(isLoggedIn) {
    // REFACTORED: Moved DOM logic to bindAuthMenuUI
    const signOutText = Strings.get('sign_out', appStore.getState().userData?.native_language) || 'Sign Out';
    const signInText = Strings.get('sign_in', appStore.getState().userData?.native_language) || 'Sign In';
    bindAuthMenuUI(isLoggedIn, handleAuthClick, signOutText, signInText);
}

// INITIALIZE APP 
async function initializeApp() {
    // Initialize reactive UI subscriptions first so the UI responds to store changes 
    // from the moment any state is set during initialization. 
    initUISubscriptions();
    initMissionToggle();

    const isDemoMode = new URLSearchParams(window.location.search).has('demo');
    appStore.getState().setDemoMode(isDemoMode);

    try {
        requestPersistentStorage();
        const isLoggedIn = await isUserLoggedIn();
        setupAuthMenu(isLoggedIn);
        const userData = await getUserProfile();
        appStore.getState().setCourseData({ userData });

        if (!isLoggedIn) {
            console.warn('User not authenticated. Proceeding as guest.');
            showGuestLoginModal();
        }

        State.initializeUserMetrics(appStore.getState().userData, calculateCurrentStreak);
        initMicAnimation();
        // Immediately trigger offline score sync if needed
        syncOfflineScores(appStore.getState().userData);

        // 1. Gather context
        const urlParamsApp = new URLSearchParams(window.location.search);
        const courseContext = {
            urlCourseId: getUrlParamCaseInsensitive(urlParamsApp, 'courseid'),
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
                statsContainer: DOM.statsContainer,
                progressbar: DOM.progressbar,
                progressBarFill: DOM.progressBarFill,
                speechTextHere: DOM.speechText,
                chatMessageList: document.getElementById('chat-message-list')
            }
        });

        //   CRITICAL TO PREVENT RAM OVERLOAD: Render the UI and Video FIRST
        await initializeLesson();

        //   CRITICAL TO PREVENT RAM OVERLOAD: Boot Whisper and NLP background models IN SEQUENCE
        // Note: Deferred to React App shell component.

    } catch (error) {
        console.error("Initialization error:", error);
        hidePreloader();
        showInitializationErrorMessage(Strings.get('lesson_load_error', appStore.getState().userData?.native_language));
    }
}

async function requestPersistentStorage() {
    // Check if the browser supports the Storage API
    if (navigator.storage && navigator.storage.persist) {
        // Check if we already have persistent storage
        let isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
            // Request persistent storage
            isPersisted = await navigator.storage.persist();
        }
        if (isPersisted) {
            console.log("  Storage is persistent. The browser will not auto-delete the GECToR models.");
        } else {
            console.warn("  Persistent storage not granted. Models may be cleared if the device runs low on space.");
        }
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