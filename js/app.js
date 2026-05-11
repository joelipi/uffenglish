// --- SMART LOG SWITCH ---
// This overrides console.log to prevent console clutter.
// To see logs for a specific module, change its value to true in the window.enabledLogs object below.
const originalConsoleLog = console.log;
window.enabledLogs = {
    whisper: false,   // Silenced as requested
    recording: false,
    api: false,
    tanstack: false,
    toggle: false,
    ai: false,
    analytics: false
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
// -----------------------

import { clearSpeechRecordingsForLesson, updateSpeechRecording } from './modules/storage.js';

// Initialize the background NLP Worker via blob URL to bypass service worker caching

let nlpModelsReady = false;

// --- UI & Media Components (Root Directory) ---
import { SuccessLessonHandler } from './components/success-lesson.js';
import { pointLoss } from './components/point-loss-animation.js';
import { initVideoProcessor } from './modules/video-processor.js';

import { calculateCurrentStreak } from './modules/user-profile.js';
import { updateActivityDisplay } from './components/ui.js';

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
    isListening,
    initLocalVoiceAI
} from './modules/speech.js';

import {
    getCurrentQuestionIndex,
    isLastAiQuestionInLesson,
    processAnswerLogic,
    validateAnswerPrecheck
} from './modules/answers.js';
// --- Extracted Modules ---
import { resolveCurrentLessonId, resolveCurrentCourseId, getNextQuestion } from './modules/lesson-router.js';
import { normalizeConfig } from './modules/config-normalizer.js';
import { loadVideoForQuestion } from './modules/video-loader.js';
import { appStore } from './modules/store.js';
//window.appStore = appStore; // <-- ADD THIS TEMPORARY LINE FOR TESTING
import { State } from './modules/state.js';
import { getLocalizedTranslation } from './modules/utils.js';
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import { buildFeedbackData, buildExplanationData } from './modules/feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from './components/feedback-renderer.js';
import { loadQuestion as _loadQuestion } from './components/question-loader.js';
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
    updateSpeakingScoreDisplay,
    ensureWebcamPreview,
    hideWebcamPreview,
    removeWebcamPreview,
    clearPlaybackVideo,
    prepareMediaUI,
    showPlaybackVideo,
    markButtonAsCorrect,
    markButtonAsIncorrect,
    initTutorChatUI,
    showTutorChatInput,
    hideTutorChatInput,
    getChatHistoryContext,
    renderTutorMessage,
    animateHeartLoss,
    resetHeartsUI,
    showContinueButton,
    hideContinueButton,
    renderFallbackContinueButton,
    toggleScoresAndHearts,
    setProgressBarWidth,
    showMessageInQuestionsContainer,
    showErrorMessageInQuestionsContainer,
    setupLessonUI,
    generateHangmanHint,
    showGuestLoginModal,
    initUISubscriptions,
    handlecueUI,
    handleIncueUI
} from './components/ui.js';

import { idiomChecker } from './modules/idiom-checker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';

const hearts = [DOM.heart1, DOM.heart2, DOM.heart3];

// Speaking Score Logic ---
window.addEventListener('transcriptRejected', (e) => {
    const cue = e.detail?.cue || "unknown_cue";
    const transcript = e.detail?.transcript || "unknown_transcript";
    logInteraction(cue, transcript, "rej_usr", "User rejected Whisper transcription");

    // Deduct 20 points, floor at 0
    appStore.getState().deductSpeakingScore(20);

    // Show point loss animation explicitly on the score span (subscription handles the text update)
    if (DOM.phrasesScore) {
        pointLoss.show(DOM.phrasesScore, 20);
    }
});

window.addEventListener('preflightRejected', () => {
    // ✅ FIX: Use the correct Zustand action for the Speaking Score
    appStore.getState().deductSpeakingScore(10);

    // Show point loss animation (subscription handles the text update)
    if (DOM.phrasesScore) {
        pointLoss.show(DOM.phrasesScore, 10);
    }
});



// 🎓🎓🎓🎓🎓🎓🎓🎓 CORE ANSWER HANDLING 🎓🎓🎓🎓🎓🎓🎓🎓


function handleHint(qIndex) {
    showHintsAndScroll();
}

export async function submitAnswerPrecheck(val, cue, questionData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }, userData = State.userData, configData = State.configData, courseId = State.courseId) {
    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, questionData, englishLevel, userData, State.cuesGiven
    );

    if (!isValid) {
        logInteraction(cue, val, "rej_pre", warningMessage);

        if (!State.isTextMode) {
            // ✅ FIX: Now correctly deducts from the Speaking Score instead of the Listening Score
            appStore.getState().deductSpeakingScore(10);

            // Show point loss animation (subscription handles the text update)
            if (DOM.phrasesScore) {
                pointLoss.show(DOM.phrasesScore, 10);
            }
        } else {
            console.log('[submitAnswerPrecheck] Text mode: skipping speaking score deduction');
        }
        if (DOM.micStatusText) {
            DOM.micStatusText.innerHTML = `<div class='text-center text-danger'>${warningMessage}</div>`;
        }
        
        // Update the recording anyway so the final video has subtitles for this incorrect attempt!
        const currentLessonId = resolveCurrentLessonId(configData, courseId);
        const qIndex = getCurrentQuestionIndex(questionData, configData, courseId);
        await updateSpeechRecording(currentLessonId, qIndex, {
            userResponse: val,
            cue: cue,
            isTextMode: State.isTextMode,
            duration: State.isTextMode ? 3 : null
        });

        // Apply speech results to the InteractiveVideoPlayer if present
        if (State.player && State.player.controller && State.player.controller.applySpeechResult) {
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
    if (State.player && State.player.controller && State.player.controller.applySpeechResult) {
        const correctIndices = State.player.controller.tokens.map((_, i) => i);
        State.player.controller.applySpeechResult(correctIndices, []);
    }

    await handleAnswer(val, cue, questionData, btn, explanation, translation, stats, userData, configData, courseId);
}

function resetButtonState(button) {
    if (button) {
        button.disabled = false;
        button.classList.remove('disabled');
        button.style.display = "inline-block";
        button.innerHTML = '<i class="bi bi-mic-fill"></i>';
        button.classList.remove('btn-danger', 'btn-danger-recording');
    }
}

// buildStatsBlocks has been extracted to feedback-builder.js (data) + feedback-renderer-web.js (HTML)

export async function handleAnswer(userResponse, cue, questionData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }, userData = State.userData, configData = State.configData, courseId = State.courseId) {
    let speechAnalytics = null;
    let cleanWordCount = 0;
    const qIndex = getCurrentQuestionIndex(questionData, configData, State.currentLessonIndex);

    try {
        const currentLessonId = (configData && configData.lessons && configData.lessons[State.currentLessonIndex]) ? configData.lessons[State.currentLessonIndex].lessonId : 'unknown_lesson';
        
        if (questionData.inputType === "speech" || questionData.inputType === "ai") {
            cleanWordCount = userResponse.replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean).length;
            if (stats && stats.netDuration !== null) {
                speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, courseId ? courseId.substring(0, 2).toUpperCase() : 'A1', questionData.inputType);
                if (speechAnalytics && stats.hesitation !== undefined) {
                    speechAnalytics.hesitation = stats.hesitation;
                }
            } else {
                speechAnalytics = {}; // fallback
            }
            if (State.isTextMode) {
                if (speechAnalytics) {
                    speechAnalytics.pronunciationScore = 100;
                    speechAnalytics.flowScore = 100;
                    speechAnalytics.wpm = 0;
                    speechAnalytics.pauseCount = 0;
                    speechAnalytics.netDuration = 3;
                }
                console.log('[handleAnswer] Text mode: overridden speech metrics for scoring');
            }
            await updateSpeechRecording(currentLessonId, qIndex, {
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
    clearMicStatusAndHideMedia();
    hideHints();

    let immediateStatsHtmlArr = [];
    disableAllButtons(button.parentElement);

    try {
        const englishLevel = configData?.languageLevel || 'A0';
        const lesson = (configData && configData.lessons) ? configData.lessons[State.currentLessonIndex] : null;

        if (!lesson) {
            throw new Error("configData or lessons missing in handleAnswer");
        }

        let result = null;
        if (questionData.inputType === "speech" || questionData.inputType === "ai") {
            result = await processAnswerLogic({
                userResponse, cue, questionData,
                lesson: lesson,
                english_level: englishLevel,
                userData: userData,
                cuesGiven: State.cuesGiven,
                apiRoot: State.apiRoot
            });
            
            if (!result) {
                console.warn("⚠️ No result from local NLP — no Gemini fallback active. Treating as passed.");
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

        logInteraction(cue, userResponse, status, pragmaticDetails, grammarCorrection);

        // Log idioms and pragmatics to the global state arrays if they exist in the result object
        if (result?.foundIdioms?.length > 0) {
            State.recognizedIdioms.push(...result.foundIdioms);
        }
        if (result?.intentLabels?.length > 0) {
            State.pragmaticFlags.push(...result.intentLabels);
        }

        const { listeningScore, speakingScore, incorrectAttempts } = appStore.getState();

        if (questionData.inputType === "speech" || questionData.inputType === "ai") {
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
                attemptNumber: attemptNumber
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
                scoreData, speechAnalytics, result, questionData,
                lang: userData?.native_language, englishLevel,
                attemptNumber: incorrectAttempts + 1
            });
            immediateStatsHtmlArr = renderFeedbackToHTML(feedbackData);
        }

        // --- SILENT RETRY FLOW FOR SPEECH ---
        if (!isCorrect && questionData.inputType === "speech" && incorrectAttempts <= 1) {
            // Use silent mode for handleIncueUI
            handleIncueUI(qIndex, questionData, button, cue, userResponse, result.explanations || explanation, result.normalizeduserResponse, result.normalizedcue, questionData.question, true, userData, configData);

            clearPlaybackVideo();
            // Speech Hangman Logic: Show hint and stay on question
            const hangmanHTML = generateHangmanHint(userResponse, cue);
            const hintUncommonWords = document.getElementById("hintUncommonWords");
            if (hintUncommonWords) hintUncommonWords.innerHTML = hangmanHTML;
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

            // Restore the question text in the mic status area
            const micStatusDiv = document.createElement('div');
            micStatusDiv.className = 'text-center';
            micStatusDiv.textContent = questionData.question || "";
            setMicStatusText(micStatusDiv);

            resetButtonState(button);

            return; // EXIT EARLY: No chat bubbles, no proceed
        }

        // --- STANDARD UI RENDERING LOGIC (POST-EVALUATION) ---
        if (questionData.inputType === "ai" && userResponse && DOM.speechText) {
            const lang = userData?.native_language;
            const localizedTrans = getLocalizedTranslation(questionData.translation, lang);
            const translationStr = (localizedTrans && lang && lang !== 'en') ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>` : "";
            renderAIFeedback([`<strong>${cue}${translationStr}</strong>`]);
            renderUserResponse(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
            renderAIAnalysisLoading();
        } else if (questionData.inputType === "speech" && userResponse && DOM.speechText) {
            renderUserResponse(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        }

        // --- WEB ADAPTER: Translate Pure Data to Web UI ---
        const explanationData = buildExplanationData(result?.explanations, explanation);
        const webFormattedExplanations = renderExplanationsToHTML(explanationData);

        // Show the tutor chat input once the evaluation completes
        showTutorChatInput();

        if (isCorrect) {
            if (questionData.inputType === "ai") {
                State.cuesGiven.push(result.normalizeduserResponse);
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

            handlecueUI(qIndex, questionData, button, cue, webFormattedExplanations, translation, userResponse, result ? result.cefrLevel : undefined, result ? result.cefrLevelDeduction : undefined, userData, configData);
            showFeedbackAndProceed(questionData, isCorrect, userData, configData);
        } else {
            // Pass the webFormattedExplanations instead of result.explanations
            handleIncueUI(qIndex, questionData, button, cue, userResponse, webFormattedExplanations, result ? result.normalizeduserResponse : "", result ? result.normalizedcue : "", questionData.question, false, userData, configData);
            showFeedbackAndProceed(questionData, isCorrect, userData, configData);
        }
    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, "", "", translation, false, userData, configData);
        showFeedbackAndProceed(questionData, false, userData, configData);
    }
}

// handlecueUI and handleIncueUI have been extracted to components/ui.js

function showFeedbackAndProceed(questionData, isCorrect) {
    if ((questionData.inputType === "speech" || questionData.inputType === "ai") && questionData.videoUrl) State.questionCount++;

    try {
        hideHints();

        const continueButton = showContinueButton(questionData.inputType === "lessonIntro", () => {
            if (questionData.inputType === "lessonIntro") {
                const initializeMedia = async () => {
                    await Media.enableAudioSystem();
                    await warmUpSpeechCamStream();
                };
                initializeMedia();
            }

            hideContinueButton();
            if (questionData.inputType === "lessonIntro") {
                setTimeout(() => loadNextQuestion(questionData), 2000);
            } else {
                if (isCorrect || appStore.getState().incorrectAttempts > 2) loadNextQuestion(questionData);
                else {
                    const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
                    window.__currentQuestionIndex = qIndex;
                    loadQuestion(State.configData.lessons[State.currentLessonIndex].questions[qIndex], State.configData.lessons[State.currentLessonIndex]);
                }
            }
        });

        if (isCorrect || appStore.getState().incorrectAttempts > 2) {
            const nextQuestion = getNextQuestion(questionData, State.configData, State.currentLessonIndex);
            if (nextQuestion && nextQuestion.videoUrl) {
                const videoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${nextQuestion.videoUrl}.mp4?alt=media`;
                Media.preloader.preloadOnly(videoUrl);
            }
        }

    } catch (error) {
        renderFallbackContinueButton(Strings.get('btn_continue', State.userData?.native_language) || 'Continue', () => {
            if (isCorrect || appStore.getState().incorrectAttempts > 2) loadNextQuestion(questionData);
            else loadQuestion(questionData, State.configData.lessons[State.currentLessonIndex]);
        });
    }
}

// ➡➡➡➡➡➡➡➡⛰🗻 ADVANCE VIEWS CORE HOLY OF HOLIES ➡➡➡➡➡➡➡➡⛰🗻

// loadQuestion has been extracted to question-loader-web.js.
// This wrapper injects the app.js dependencies that the module needs.
function loadQuestion(question, lesson, fluencyData) {
    _loadQuestion(question, lesson, fluencyData, {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint
    });
}

// getNextQuestion has been moved to lesson-router.js

function updateProgressBar() {
    if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
    const currentLesson = State.configData.lessons[State.currentLessonIndex];
    const totalQuestions = currentLesson.questions.length;
    let currentQuestions = State.questionsAnswered++;
    const finalProgress = Math.min(Math.max((currentQuestions / totalQuestions) * 100, 10), 90);
    setProgressBarWidth(`${finalProgress}%`);
}

function loadNextQuestion(currentQuestion, fluencyData) {
    updateProgressBar();
    toggleScoresAndHearts(false);

    State.resetForNextQuestion();
    // No manual updateCurrentScoreDisplay call needed: resetForNextQuestion() updates the store,
    // and the subscription will automatically sync the UI.

    resetHeartsUI();

    if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
    const currentLesson = State.configData.lessons[State.currentLessonIndex];
    State.currentQuestionIndex++;

    if (State.currentQuestionIndex < currentLesson.questions.length) {
        loadQuestion(currentLesson.questions[State.currentQuestionIndex], currentLesson, fluencyData);
    } else {
        if (currentLesson.nextLessonId) loadNextLesson();
        else showCompletionMessage();
    }
}

function showCompletionMessage() {
    showMessageInQuestionsContainer(Strings.get('msg_lesson_complete_all', State.userData?.native_language));
}

async function loadNextLesson() {
    if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
    const currentLesson = State.configData.lessons[State.currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        saveLessonProgress(State.courseId, nextLessonId, State.userData).then(progressResult => {
            if (progressResult.dayCountIncremented) {
                // Update the store; subscription handles the display
                appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
            }
        });

        setTimeout(async () => {
            const nextLessonIndex = State.configData.lessons.findIndex(l => l.lessonId === nextLessonId);

            if (nextLessonIndex !== -1) {
                State.currentLessonIndex = nextLessonIndex;
                localStorage.setItem(`${State.courseId}_currentLessonId`, nextLessonId);
                localStorage.setItem(`${State.courseId}_currentLessonTimestamp`, new Date().toISOString());
                setProgressBarWidth("100%");
                State.questionsAnswered = 0;
                State.currentQuestionIndex = 0;
                loadLessonContent(State.configData.lessons[nextLessonIndex]);
            } else showCompletionMessage();
        }, 1200);
    } else {
        Media.playSound('lesson-complete-sound'); showCompletionMessage();
    }
}

// 🏫🏫🏫🏫🏫🏫🏫🏫 INITIALIZATION/LESSON SETUP 🏫🏫🏫🏫🏫🏫🏫🏫

async function handleTutorChatSubmit(rawText) {
    if (!rawText || !rawText.trim()) return;

    const wordCount = rawText.trim().split(/\s+/).length;
    appStore.getState().incrementUserTutorStats(wordCount);

    // Show user's message
    renderTutorMessage(rawText, true);

    // Show loading
    renderAIAnalysisLoading(Strings.get('ai_thinking', State.userData?.native_language));

    // Get context and send to API
    const context = getChatHistoryContext();
    const aiResponse = await askEnglishTutor(context, rawText);

    const aiWordCount = aiResponse.trim().split(/\s+/).length;
    appStore.getState().incrementAiTutorStats(aiWordCount);

    // Remove the loading indicator explicitly in case the render function doesn't
    const loadingStatus = document.getElementById('ai-loading-status');
    if (loadingStatus) {
        loadingStatus.remove();
    }

    // Show AI response
    renderTutorMessage(aiResponse, false);
}

async function initializeLesson(courseId = State.courseId, configData = State.configData, userData = State.userData) {
    try {
        // Initialize the Tutor Chat UI and bind the submission logic
        initTutorChatUI(handleTutorChatSubmit);

        // 1. Gather browser-specific context
        const urlParams = new URLSearchParams(window.location.search);
        const routerContext = {
            urlLessonId: urlParams.get('lessonid'),
            storedLessonId: localStorage.getItem(`${courseId}_currentLessonId`),
            storedTimestamp: localStorage.getItem(`${courseId}_currentLessonTimestamp`)
        };

        // 2. Call the pure logic function
        const lessonId = resolveCurrentLessonId(configData, userData, courseId, routerContext);

        // 3. Execute Browser Side-Effects (Previously hidden inside lesson-router.js)
        if (routerContext.urlLessonId) {
            const url = new URL(window.location.href);
            url.searchParams.delete('lessonid');
            url.searchParams.delete('course');
            window.history.replaceState({}, document.title, url.toString());
        }
        await saveLessonProgress(courseId, lessonId, userData, { updateUserMeta: false, incrementCount: false });

        if (!configData || !configData.lessons) return;
        const lesson = configData.lessons.find(l => l.lessonId === lessonId);
        if (!lesson) return;
        State.currentLessonIndex = configData.lessons.findIndex(l => l.lessonId === lessonId);

        if (window.preloadLessonAssets) {
            const constructFirebaseUrl = (slug) => `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${slug}.mp4?alt=media`;
            await window.preloadLessonAssets(lesson, constructFirebaseUrl);
        }

        loadLessonContent(lesson, configData);
    } catch (error) {
        console.error("initializeLesson error:", error);
        const preloader = document.getElementById('appLoadingImageDiv');
        if (preloader) preloader.style.display = 'none';
        showErrorMessageInQuestionsContainer(Strings.get('lesson_load_error', userData?.native_language));
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
    State.roleA = lesson.roleA || "";
    State.roleB = lesson.roleB || "";
    State.userRole = lesson.userRole || "";
    State.videoRole = lesson.videoRole || "";

    // No manual updateCurrentScoreDisplay call needed: the store subscription handles it.
    // updateActivityDisplay is still called here because dayCount/currentStreak haven't changed yet
    // (they will be set by saveLessonProgress callbacks later); this ensures the header shows
    // the correct values immediately on lesson load.
    updateActivityDisplay(appStore.getState().dayCount, appStore.getState().currentStreak);

    resetHeartsUI();

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
    loadQuestion(lesson.questions[State.currentQuestionIndex], lesson, null);
}

async function handleAuthClick(e) {
    e.preventDefault();
    const isLoggedIn = await isUserLoggedIn();
    if (isLoggedIn) {
        if (confirm('Are you sure you want to sign out?')) {
            await signOut();
            window.location.href = 'homescreen.html';
        }
    } else {
        const currentUrl = window.location.pathname + window.location.search;
        window.location.href = `login.html?redirect=${encodeURIComponent(currentUrl)}`;
    }
}

function setupAuthMenu(isLoggedIn) {
    const authLink = document.getElementById('auth-link');
    if (!authLink) return;

    if (isLoggedIn) {
        authLink.textContent = Strings.get('sign_out', State.userData?.native_language) || 'Sign Out';
    } else {
        authLink.textContent = Strings.get('sign_in', State.userData?.native_language) || 'Sign In';
    }

    authLink.removeEventListener('click', handleAuthClick);
    authLink.addEventListener('click', handleAuthClick);
}

// 🚀🚀🚀🚀🚀🚀🚀🚀 INITIALIZE APP 🚀🚀🚀🚀🚀🚀🚀🚀

async function initializeApp() {
    // Initialize reactive UI subscriptions first so the UI responds to store changes 
    // from the moment any state is set during initialization. 
    initUISubscriptions();

    try {
        requestPersistentStorage();
        const isLoggedIn = await isUserLoggedIn();
        setupAuthMenu(isLoggedIn);

        State.userData = await getUserProfile();

        if (!isLoggedIn) {
            console.warn('User not authenticated. Proceeding as guest.');
            // showGuestLoginModal(); // Temporarily turned off during testing
        }
        State.initializeUserMetrics(State.userData, calculateCurrentStreak);

        // Immediately trigger offline score sync if needed
        syncOfflineScores(State.userData);

        // 1. Gather context
        const courseContext = {
            urlCourseId: new URLSearchParams(window.location.search).get('courseid'),
            storedCourseId: localStorage.getItem('currentCourse'),
            wpCourseId: State.userData?.current_course || null
        };

        // 2. Pure function evaluation
        State.courseId = resolveCurrentCourseId(State.userData, courseContext);

        // 3. Side effects
        localStorage.setItem('currentCourse', State.courseId);
        if (State.userData && typeof State.userData === 'object') {
            await saveCourseToUserProfile(State.courseId, State.userData);
        }

        // --- FETCH CONFIG AND SET LANGUAGE LEVEL ---
        const response = await fetch(`js/config/${State.courseId}.json`);
        State.configData = await response.json();

        // Pull level directly from the JSON field (e.g., "B1")
        State.englishLevel = State.configData.languageLevel || 'A0';
        console.log(`Course Level initialized to: ${State.englishLevel}`);

        normalizeConfig(State.configData, State.userData?.native_language);

        State.successHandler = new SuccessLessonHandler({
            configData: State.configData,
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
                scoresAndHearts: DOM.scoresAndHearts,
                progressbar: DOM.progressbar,
                progressBarFill: DOM.progressBarFill,
                speechTextHere: DOM.speechText,
                bottomButtonBarCenter: document.getElementById('bottomButtonBarCenter'),
                bottomButtonBarLeft: document.getElementById('bottomButtonBarLeft'),
                hearts
            }
        });

        // 🛑 CRITICAL TO PREVENT RAM OVERLOAD: Render the UI and Video FIRST
        await initializeLesson();

        // 🛑 CRITICAL TO PREVENT RAM OVERLOAD: Boot Whisper and NLP background models IN SEQUENCE
        (async () => {
            try {
                let voiceInitFn = initLocalVoiceAI;

                if (typeof voiceInitFn !== 'function') {
                    console.warn('initLocalVoiceAI not available statically, attempting dynamic import...');
                    const scriptDir = new URL('.', import.meta.url).href;
                    const speechModuleUrl = new URL('modules/speech.web.js?8', scriptDir).href;
                    const speechModule = await import(speechModuleUrl);
                    voiceInitFn = speechModule.initLocalVoiceAI;
                }

                if (typeof voiceInitFn === 'function') {
                    await Promise.resolve(voiceInitFn());
                    console.log('🎙️ Whisper initialization complete.');
                }
            } catch (err) {
                console.error('Voice AI initialization error:', err);
            } finally {
                loadLocalModelsInBackground();
            }
        })();

    } catch (error) {
        console.error("Initialization error:", error);
        const preloader = document.getElementById('appLoadingImageDiv');
        if (preloader) preloader.style.display = 'none';
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
            console.log("✅ Storage is persistent. The browser will not auto-delete the GECToR models.");
        } else {
            console.warn("⚠️ Persistent storage not granted. Models may be cleared if the device runs low on space.");
        }
    }
}

async function loadLocalModelsInBackground() {

    // Hardcode to true to allow idiomChecker to boot while NLP worker is disabled
    nlpModelsReady = true;

    // 👉 SEQUENTIAL LOAD: Boot the idiom checker ONLY after the NLP worker is finished
    if (nlpModelsReady) {
        try {
            console.log("📚 Local NLP bypassed. Now fetching and building idiom dictionary...");
            await idiomChecker.init();
            console.log("✅ Idiom checker ready!");
        } catch (err) {
            console.error("❌ Failed to initialize idiom checker:", err);
        }
    }
}

// Check if the page is already loaded before adding the listener.
// This prevents the "silent hang" race condition.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}