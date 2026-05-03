
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

/**
 * Gets the localized string from a translation object or string.
 * @param {string|object} translationData - The translation string or object (e.g. { es: "Hola" }).
 * @param {string} lang - The user's native language code (e.g., 'es').
 * @returns {string} - The extracted string.
 */
function getLocalizedTranslation(translationData, lang) {
    if (!translationData) return '';
    if (typeof translationData === 'string') return translationData;
    return translationData[lang] || '';
}

// --- Decoupled Business Logic (Modules Directory) ---
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage } from './modules/scoring.js';
import { isUserLoggedIn, getUserProfile, signOut } from './modules/api.js';
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
import getRandomPraise from './modules/praise.js';

// --- Extracted Modules ---
import { getCurrentLessonId, getCurrentcourseId } from './modules/lesson-router.js';
import { normalizeConfig } from './modules/config-normalizer.js';
import { loadVideoForQuestion } from './modules/video-loader.js';
import { State } from './modules/state.js';
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import {
    DOM,
    flashElement,
    updateCurrentScoreDisplay,
    updateDayCountDisplay,
    disableAllButtons,
    clearChatInterface,
    renderUserResponse,
    renderAIAnalysisLoading,
    createStatsBubbleHTML,
    createGrammarDiffHTML,
    createHeaderHTML,
    createPragmaticsBubbleHTML,
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
    animateHeartLoss,
    resetHeartsUI,
    showContinueButton,
    hideContinueButton,
    renderFallbackContinueButton,
    resetUIForNewQuestion,
    toggleScoresAndHearts,
    removeRepeatButton,
    clearMediaContainerAndPreservePlayers,
    renderImageInMediaContainer,
    renderYoutubeInMediaContainer,
    resetAnswersContainer,
    renderSpeechInputUI,
    renderTextInputUI,
    updateProgressAndCloseButton,
    setProgressBarWidth,
    hideAnswerDiv,
    bindProcessButton,
    renderMultiChoiceUI,
    showMessageInQuestionsContainer,
    showErrorMessageInQuestionsContainer,
    setupLessonUI,
    generateHangmanHint,
    showGuestLoginModal
} from './components/ui.js';

import { idiomChecker } from './modules/idiom-checker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';

const hearts = [DOM.heart1, DOM.heart2, DOM.heart3];

// Speaking Score Logic ---
window.addEventListener('transcriptRejected', () => {
    // Deduct 20 points, floor at 0
    State.speakingScore = Math.max(0, State.speakingScore - 20);

    // Update the UI
    updateSpeakingScoreDisplay(State.speakingScore);
    if (DOM.phrasesScore) {
        flashElement(DOM.phrasesScore);
        // Show point loss animation explicitly on the score span
        pointLoss.show(DOM.phrasesScore, 20);
    }
});

window.addEventListener('preflightRejected', () => {
    State.currentPoints = Math.max(0, State.currentPoints - 10);
    updateCurrentScoreDisplay(State.currentPoints);
    if (DOM.phrasesScore) {
        flashElement(DOM.phrasesScore);
        pointLoss.show(DOM.phrasesScore, 10);
    }
});



// 🎓🎓🎓🎓🎓🎓🎓🎓 CORE ANSWER HANDLING 🎓🎓🎓🎓🎓🎓🎓🎓


function handleHint(qIndex) {
    showHintsAndScroll();
}

async function submitAnswerPrecheck(val, cue, questionData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }) {
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, questionData, State.englishLevel, State.userData, State.cuesGiven
    );

    if (!isValid) {
        State.currentPoints = Math.max(0, State.currentPoints - 10);
        updateCurrentScoreDisplay(State.currentPoints);
        if (DOM.phrasesScore) {
            flashElement(DOM.phrasesScore);
            pointLoss.show(DOM.phrasesScore, 10);
        }
        if (DOM.micStatusText) {
            DOM.micStatusText.innerHTML = `<div class='text-center text-danger'>${warningMessage}</div>`;
        }
        if (btn) btn.disabled = false;
        return;
    }

    await handleAnswer(val, cue, questionData, btn, explanation, translation, stats);
}

async function handleAnswer(userResponse, cue, questionData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }) {
    try {
        const currentLessonId = (State && State.configData && State.configData.lessons && State.configData.lessons[State.currentLessonIndex]) ? State.configData.lessons[State.currentLessonIndex].lessonId : 'unknown_lesson';
        const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
        let analyticsToSave = {};
        if (stats && stats.netDuration !== null) {
            analyticsToSave = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, State.courseId ? State.courseId.substring(0, 2).toUpperCase() : 'A1', questionData.inputType);
        }
        await updateSpeechRecording(currentLessonId, qIndex, {
            userResponse,
            cue,
            wpm: analyticsToSave.wpm,
            pauseCount: analyticsToSave.pauseCount,
            complexityScore: analyticsToSave.complexityScore
        });
        console.log("Successfully updated speech recording with answers");
    } catch (e) {
        console.error("Error updating speech recording with answers", e);
    }

    Media.pauseVideoIfPlaying();

    clearMicStatusAndHideMedia();
    hideHints();

    let speechAnalytics = null;
    let immediateStatsHtmlArr = [];

    if (questionData.inputType === "speech" || questionData.inputType === "ai") {
        speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, State.courseId ? State.courseId.substring(0, 2).toUpperCase() : 'A1', questionData.inputType);

        const listeningScore = State.currentPoints || 0;
        const speakingScore = State.speakingScore || 0;

        immediateStatsHtmlArr.push(createStatsBubbleHTML(
            Strings.get('stats_listening_header', State.userData?.native_language).replace('{score}', listeningScore), []
        ));

        immediateStatsHtmlArr.push(createStatsBubbleHTML(
            Strings.get('stats_speaking_header', State.userData?.native_language).replace('{score}', speakingScore), []
        ));

        let flowParts = [
            `<strong>${Strings.get('stats_hesitation', State.userData?.native_language)}:</strong> 0`,
            `<strong>${Strings.get('stats_pauses_speaking', State.userData?.native_language)}:</strong> ${speechAnalytics.pauseCount || 0}`,
            `<strong>${Strings.get('stats_wpm', State.userData?.native_language)}:</strong> ${speechAnalytics.wpm || 0}`
        ];

        immediateStatsHtmlArr.push(createStatsBubbleHTML(
            Strings.get('stats_speech_flow_header', State.userData?.native_language), flowParts
        ));

        // Only show Vocabulary for AI questions
        if (questionData.inputType === "ai") {
            let vocabParts = [];
            if (speechAnalytics.complexityScore !== null) {
                vocabParts.push(`<strong>${Strings.get('stats_complexity', State.userData?.native_language)}:</strong> ${speechAnalytics.complexityScore} <br><small>(${speechAnalytics.complexityScoreBreakdown})</small>`);
            }
            if (speechAnalytics.foundIdioms && speechAnalytics.foundIdioms.length > 0) {
                const idiomsList = speechAnalytics.foundIdioms.map(idiom => `<li>${idiom}</li>`).join('');
                vocabParts.push(`<strong>${Strings.get('stats_idioms', State.userData?.native_language)}:</strong> ${speechAnalytics.foundIdioms.length}<ul style="margin-bottom:0;">${idiomsList}</ul>`);
            }

            if (vocabParts.length > 0) {
                immediateStatsHtmlArr.push(createStatsBubbleHTML(
                    Strings.get('stats_vocabulary_header', State.userData?.native_language), vocabParts
                ));
            }
        }
    }

    const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
    window.__currentQuestionIndex = qIndex;
    disableAllButtons(button.parentElement);

    try {
        let result = null;

        if (!result && (questionData.inputType === "speech" || questionData.inputType === "ai")) {
            result = await processAnswerLogic({
                userResponse, cue, questionData,
                lesson: State.lesson,
                english_level: State.englishLevel,
                userData: State.userData,
                cuesGiven: State.cuesGiven,
                apiRoot: State.apiRoot
            });
        }

        if (!result) {
            console.warn("⚠️ No result from local NLP — no Gemini fallback active. Treating as passed.");
            result = { isCorrect: true, normalizeduserResponse: userResponse, normalizedcue: cue, explanation: explanation };
        }

        const isCorrect = result.isCorrect;

        // --- SILENT RETRY FLOW FOR SPEECH ---
        if (!isCorrect && questionData.inputType === "speech" && State.incorrectAttempts <= 1) {
            // Use silent mode for handleIncueUI
            handleIncueUI(qIndex, questionData, button, cue, userResponse, result.explanations || explanation, result.normalizeduserResponse, result.normalizedcue, questionData.question, true);

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

            // Re-enable and show the speech button so user can try again immediately
            if (button) {
                button.disabled = false;
                button.classList.remove('disabled');
                button.style.display = "inline-block"; // Bootstrap buttons are usually inline-block
                button.innerHTML = '<i class="bi bi-mic-fill"></i>'; // Reset to mic icon
                button.classList.remove('btn-danger', 'btn-danger-recording'); // Remove recording state colors
            }

            return; // EXIT EARLY: No chat bubbles, no proceed
        }

        // --- STANDARD UI RENDERING LOGIC (POST-EVALUATION) ---
        if (questionData.inputType === "ai" && userResponse && DOM.speechText) {
            const lang = State.userData?.native_language;
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

        if (isCorrect) {
            if (questionData.inputType === "ai") {
                State.cuesGiven.push(result.normalizeduserResponse);
                if (result.englishLevelDeduction > 0) {
                    State.currentPoints = Math.max(0, State.currentPoints - result.englishLevelDeduction);
                    updateCurrentScoreDisplay(State.currentPoints);
                }
            }
            handlecueUI(qIndex, questionData, button, cue, result.explanations || explanation, translation, userResponse, result.englishLevel, result.englishLevelDeduction);
            showFeedbackAndProceed(questionData, isCorrect, State.currentLessonIndex, qIndex);
        } else {
            handleIncueUI(qIndex, questionData, button, cue, userResponse, result.explanations || explanation, result.normalizeduserResponse, result.normalizedcue, questionData.question);
            showFeedbackAndProceed(questionData, isCorrect, State.currentLessonIndex, qIndex);
        }
    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, "", "", translation);
        showFeedbackAndProceed(questionData, false, State.currentLessonIndex, qIndex);
    }
}

function handlecueUI(qIndex, questionData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction) {

    if (questionData.inputType === "speech" && questionData.videoUrl) State.repeatPointsHistory.push(State.currentPoints);
    if (questionData.inputType === "ai" && questionData.videoUrl) State.rolePlayPointsHistory.push(State.currentPoints);

    // Unified: last AI question advances via Continue button like all others.

    if (DOM.speechText) {
        const lang = State.userData?.native_language;
        const feedbackText = (questionData.inputType === "ai" && englishLevelDeduction > 0)
            ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
            : (questionData.inputType === "ai" ? getRandomPraise() : "");

        if (questionData.inputType !== "ai" && questionData.inputType !== "speech") {
            const localizedTrans = getLocalizedTranslation(translation, lang);

            const correctBubble = document.createElement('div');
            correctBubble.classList.add('correct-answer-display', 'chat-bubble-sent', 'chat-msg');
            correctBubble.textContent = cue;

            if (localizedTrans && lang && lang !== 'en') {
                correctBubble.appendChild(document.createElement('br'));
                const transSpan = document.createElement('span');
                transSpan.lang = lang;
                const transI = document.createElement('i');
                transI.textContent = localizedTrans;
                transSpan.appendChild(transI);
                correctBubble.appendChild(transSpan);
            }

            const praiseBubble = document.createElement('div');
            praiseBubble.classList.add('chat-bubble', 'chat-msg');
            praiseBubble.style.marginTop = '12px';
            const praiseStrong = document.createElement('strong');
            praiseStrong.textContent = getRandomPraise();
            praiseBubble.appendChild(praiseStrong);

            const chunks = [correctBubble];
            if (Array.isArray(explanation)) chunks.push(...explanation);
            else if (explanation) chunks.push(explanation);
            chunks.push(praiseBubble, questionData.headsUp);

            renderAIFeedback(chunks);
        } else {
            // AI and Speech are already partially rendered in handleAnswer
            const chunks = [];
            if (Array.isArray(explanation)) chunks.push(...explanation);
            else if (explanation) chunks.push(explanation);
            chunks.push(feedbackText ? `<strong>${feedbackText}</strong>` : "", questionData.headsUp);

            renderAIFeedback(chunks);
        }

        if (questionData.inputType === "ai" || questionData.inputType === "speech") {
            updateSpeakingScoreDisplay(State.speakingScore);
            flashElement(DOM.phrasesScore);
        }
    }

    Media.playSound('correct-sound');

    if (questionData.inputType === "lessonIntro" || questionData.inputType === "speech" || questionData.inputType === "ai") {
        showPlaybackVideo();
    }

    markButtonAsCorrect(button);
}

function handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, question, silent = false) {
    State.incorrectAttempts++;

    if (!silent && (questionData.inputType === "lessonIntro" || questionData.inputType === "speech" || questionData.inputType === "ai")) {
        showPlaybackVideo();
    }

    if ((questionData.inputType === "speech" || questionData.inputType === "ai") && questionData.videoUrl) {
        State.currentPoints = Math.max(0, State.currentPoints - 25);
        pointLoss.show(DOM.micStatusText, 25);
        updateCurrentScoreDisplay(State.currentPoints);
        if (State.incorrectAttempts > 2) {
            State.currentPoints = 0;
            updateCurrentScoreDisplay(State.currentPoints);
            updateSpeakingScoreDisplay(State.speakingScore);
            State.rolePlayPointsHistory.push(State.currentPoints);
        }
    }

    if (silent) {
        animateHeartLoss(State.incorrectAttempts);
        Media.playSound('incorrect-sound');
        return;
    }

    if (questionData.inputType === "ai" && userResponse) {
        if (State.incorrectAttempts > 2) {
            State.currentPoints = 0;
            State.rolePlayPointsHistory.push(State.currentPoints);
            updateCurrentScoreDisplay(State.currentPoints);
        }

        const teacherTextStr = State.incorrectAttempts === 1
            ? Strings.get('try_again_1', State.userData?.native_language)
            : State.incorrectAttempts === 2
                ? Strings.get('try_again_2', State.userData?.native_language)
                : `${Strings.get('failed_continue_correct', State.userData?.native_language)}<br>"${cue}"`;

        const teacherDiv = document.createElement('div');
        const teacherStrong = document.createElement('strong');
        teacherStrong.innerHTML = teacherTextStr;
        teacherDiv.appendChild(teacherStrong);

        let headsUpNode = '';
        if (questionData.headsUp) {
            const headsUpText = State.incorrectAttempts <= 2 ? Strings.get('heads_up_try_again', State.userData?.native_language) : questionData.headsUp;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = headsUpText;
            headsUpNode = tempDiv;
        }

        let possibleAnswerNode = '';
        if (questionData.possibleAnswer && State.incorrectAttempts > 2) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = `${Strings.get('example_correct_answer', State.userData?.native_language)}<br>${questionData.possibleAnswer}`;
            possibleAnswerNode = tempDiv;
        }

        const chunks = [];
        if (Array.isArray(explanation)) chunks.push(...explanation);
        else if (explanation) chunks.push(explanation);

        chunks.push(teacherDiv);
        if (possibleAnswerNode) chunks.push(possibleAnswerNode);
        if (headsUpNode) chunks.push(headsUpNode);

        renderAIFeedback(chunks);
    }

    if (questionData.inputType === "speech" && userResponse && DOM.speechText) {
        const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))];
        const correctWords = [...new Set(normalizedcue.split(/\s+/))];
        const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
        const correct = new Set(); const incorrect = new Set();

        selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

        const correctUl = `<ul class='card-text correctWords list-inline' id='correctWords'>${Array.from(correct).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;
        const incorrectUl = `<ul class='card-text incorrectWords list-inline' id='incorrectWords'>${Array.from(incorrect).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;

        const teacherText = State.incorrectAttempts === 1
            ? Strings.get('try_again_1', State.userData?.native_language)
            : State.incorrectAttempts === 2
                ? Strings.get('try_again_2', State.userData?.native_language)
                : `${Strings.get('failed_continue', State.userData?.native_language)}<br><br>Correct:<br>"${cue}"`;

        const headsUpStr = questionData.headsUp
            ? (State.incorrectAttempts <= 2 ? Strings.get('heads_up_repeat_video', State.userData?.native_language) : questionData.headsUp)
            : '';

        const chunks = [`<strong>${teacherText}</strong><br><br>${correctUl}${incorrectUl}`];
        if (Array.isArray(explanation)) chunks.push(...explanation);
        else if (explanation) chunks.push(explanation);
        chunks.push(headsUpStr);

        renderAIFeedback(chunks);
    }

    animateHeartLoss(State.incorrectAttempts);

    Media.playSound('incorrect-sound');

    const answersContainer = button.parentElement;
    if (questionData.inputType !== "text") {
        markButtonAsIncorrect(button, answersContainer, cue);
    } else {
        markButtonAsIncorrect(button, null, null);
    }
}

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
                if (isCorrect || State.incorrectAttempts > 2) loadNextQuestion(questionData);
                else {
                    const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
                    window.__currentQuestionIndex = qIndex;
                    loadQuestion(State.configData.lessons[State.currentLessonIndex].questions[qIndex], State.configData.lessons[State.currentLessonIndex]);
                }
            }
        });

        if (isCorrect || State.incorrectAttempts > 2) {
            const nextQuestion = getNextQuestion(questionData);
            if (nextQuestion && nextQuestion.videoUrl) {
                const videoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${nextQuestion.videoUrl}.mp4?alt=media`;
                Media.preloader.preloadOnly(videoUrl);
            }
        }

    } catch (error) {
        renderFallbackContinueButton(Strings.get('btn_continue', State.userData?.native_language) || 'Continue', () => {
            if (isCorrect || State.incorrectAttempts > 2) loadNextQuestion(questionData);
            else loadQuestion(questionData, State.configData.lessons[State.currentLessonIndex]);
        });
    }
}

// ➡➡➡➡➡➡➡➡⛰🗻 ADVANCE VIEWS CORE HOLY OF HOLIES ➡➡➡➡➡➡➡➡⛰🗻

// Temporarily commented out alert
function beforeUnloadHandler(e) { /* e.preventDefault(); e.returnValue = ''; return ''; */ }

function loadQuestion(question, lesson, fluencyData) {
    window.__currentQuestionIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);
    clearChatInterface(); // Clear FIRST so the card collapses before we scroll
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewQuestion(question.inputType === 'lessonIntro', !!State.userData);

    Media.cleanupPreviousPlayers();
    clearPlaybackVideo();

    toggleScoresAndHearts((question.inputType === 'speech' || question.inputType === 'ai') && question.videoUrl);

    if (question.inputType === 'speech' || question.inputType === 'ai') {
        warmUpSpeechCamStream();
        if (isIOS) {
            const closePageLink = document.getElementById('closePage');
            if (closePageLink) {
                closePageLink.removeEventListener('click', handleClosePageClick);
                function handleClosePageClick(e) { if (!confirm(Strings.get('alert_lesson_reset', State.userData?.native_language))) e.preventDefault(); }
                closePageLink.addEventListener('click', handleClosePageClick);
            }
        } else {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            window.addEventListener('beforeunload', beforeUnloadHandler);
        }
    } else {
        hideWebcamPreview();
        window.removeEventListener('beforeunload', beforeUnloadHandler);
    }

    if (question.inputType != 'lessonComplete' && question.inputType != 'unitComplete') {
        removeRepeatButton();
    }

    if (question.inputType === 'speech' || question.inputType === 'ai') {
        warmUpSpeechCamStream();
        updateSpeakingScoreDisplay(State.speakingScore);
    }

    prepareMediaUI();

    clearMediaContainerAndPreservePlayers();

    if (question.image) {
        renderImageInMediaContainer(question.image);
    }
    if (question.youtube) {
        renderYoutubeInMediaContainer(question.youtube);
    }

    loadVideoForQuestion(question, State, State.userData?.native_language);

    const questionDiv = document.createElement('div');
    questionDiv.className = 'text-center';
    questionDiv.textContent = question.question;
    setMicStatusText(questionDiv);

    resetAnswersContainer(`<div id="answers-container" class="d-grid gap-2 d-none"></div>`);

    if (question.inputType === "speech" || question.inputType === "ai") {
        hideHints();

        const allHidden = false; let revealedFirst = false;
        const escapeHtml = (text) => {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return text.replace(/[&<>"']/g, (m) => map[m]);
        };

        const answerFragment = document.createDocumentFragment();
        if (question.inputType === "speech") {
            // No pulse-dot hints for speech input questions
        } else {
            const processTextToPulseDots = (text) => {
                const parts = text.split(/(\b[\w']+\b)/g);
                parts.forEach(part => {
                    if (!part) return;
                    if (/\b[\w']+\b/.test(part)) {
                        if (allHidden && !revealedFirst) {
                            revealedFirst = true;
                            answerFragment.appendChild(document.createTextNode(part)); // Use part directly, createTextNode handles escaping
                        } else {
                            const span = document.createElement('span');
                            span.className = 'pulse-dot';
                            span.dataset.word = part; // Use part directly, dataset handles escaping safely
                            const icon = document.createElement('i');
                            icon.className = 'bi bi-app';
                            span.appendChild(icon);
                            answerFragment.appendChild(span);
                        }
                    } else {
                        answerFragment.appendChild(document.createTextNode(part));
                    }
                });
            };

            processTextToPulseDots(question.cue);

            if (question.possibleAnswer) {
                answerFragment.appendChild(document.createElement('br'));
                const strong = document.createElement('strong');
                strong.textContent = Strings.get('possible_response', State.userData?.native_language);
                answerFragment.appendChild(strong);
                answerFragment.appendChild(document.createElement('br'));
                processTextToPulseDots(question.possibleAnswer);
            }
        }

        const handleRevealClick = function () {
            if (!this.dataset.revealed) {
                this.textContent = this.dataset.word;
                State.currentPoints = Math.max(0, State.currentPoints - 15);
                pointLoss.show(this, 15); updateCurrentScoreDisplay(State.currentPoints);
                this.dataset.revealed = "true"; this.removeEventListener('click', handleRevealClick);
            }
        };

        const qIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);

        renderSpeechInputUI(
            answerFragment,
            question.inputType === "speech" ? null : () => handleHint(qIndex),
            handleRevealClick,
            async () => {
                const speechButton = document.getElementById('speechButton');
                try {
                    await toggleSpeechRecognition({
                        button: speechButton,
                        question,
                        micStatusText: DOM.micStatusText,
                        userData: State.userData,
                        configData: State.configData,
                        currentLessonIndex: State.currentLessonIndex,
                        currentQuestionIndex: qIndex,
                        handleAnswer: submitAnswerPrecheck,
                        player: State.player
                    });
                } catch (error) {
                    console.error("Speech toggle failed", error);
                }
            }
        );

    } else if (question.inputType === 'text') {
        renderTextInputUI(
            Strings.get('placeholder_type_answer', State.userData?.native_language) || 'Type your answer here...',
            Strings.get('btn_submit', State.userData?.native_language) || 'Submit',
            (val, btn) => submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, question.translation, { pauseCount: null, netDuration: null })
        );

    } else if (question.inputType === 'lessoncomplete') {
        updateProgressAndCloseButton(true); toggleScoresAndHearts(false);
        setProgressBarWidth("95%"); showFeedbackAndProceed(question, true);
        hideAnswerDiv();

    } else if (question.inputType === 'unitcomplete') {
        question.lessonId = State.configData.lessons[State.currentLessonIndex].lessonId + 's';
        State.successHandler.handleSuccessLesson(question);

    } else if (question.inputType === 'lessonIntro') {
        toggleScoresAndHearts(false);
        State.repeatPointsHistory = [];
        State.rolePlayPointsHistory = [];
        hideAnswerDiv();

        if (!question.simpleVideoUrl && question.explanation) {
            const lang = State.userData?.native_language; const localizedTrans = getLocalizedTranslation(question.translation, lang); const hasTranslation = !!localizedTrans;
            const imagineStr = Strings.get('imagine', lang); const listenRepeatStr = Strings.get('listen_repeat', lang);

            const explanationStr = `
            <p class='explanation'>
              <strong>${imagineStr.split('<br>')[0]}</strong> ${question.explanation}
              <br><br>
              ➡${listenRepeatStr.split('<br>')[0]}
              ${hasTranslation && lang !== 'en' ? `<br><br><span lang='${lang}'><i><strong>🎯${imagineStr.includes('<br>') ? imagineStr.split('<i>')[1].split('<i>')[0] : imagineStr}</strong>${localizedTrans}<br><br>${listenRepeatStr.includes('<br>') ? listenRepeatStr.split('<i>')[1].split('<i>')[0] : listenRepeatStr}</i></span>` : ''}
            </p>`;

            renderAIFeedback([
                `<p class='lesson-name'><strong>Lesson: ${lesson.title}</strong></p>`,
                explanationStr
            ]);
        }
        showFeedbackAndProceed(question, true);

    } else if (question.inputType === 'present') {
        updateProgressAndCloseButton(false); toggleScoresAndHearts(false); hideAnswerDiv();

        let headsUpHTML = question.headsUp ? `<div class='chat-bubble chat-msg'><p class='headsUp'>${question.headsUp}</p></div>` : "";

        if (!question.simpleVideoUrl) {
            let explanationStr = "";
            if (question.explanation) {
                const lang = State.userData?.native_language;
                const expTrans = getLocalizedTranslation(question.translation, lang);
                explanationStr = `<p class='explanation'>${question.explanation}${expTrans && lang && lang !== 'en' ? `<br><br><span lang='${lang}'><i>${expTrans}</i></span>` : ""}</p>`;
            }

            renderAIFeedback([
                `<p class='lesson-name'><strong>${Strings.get('lesson_label', State.userData?.native_language)} ${lesson.title}</strong></p>`,
                explanationStr
            ]);
        }
        showFeedbackAndProceed(question, true);

    } else if (question.inputType === 'success') {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        bindProcessButton(() => State.player.destroy());

        question.lessonId = State.configData.lessons[State.currentLessonIndex].lessonId;

        // Explicitly hand the config to the window object before calling the processor 👇
        window.__currentConfigData = State.configData;

        initVideoProcessor(question.cue, fluencyData, question.lessonId);
        State.successHandler.handleSuccessLesson(question);

        const currentLesson = State.configData.lessons[State.currentLessonIndex];
        const nextLessonId = currentLesson.nextLessonId;

        if (nextLessonId) {
            saveLessonProgress(State.courseId, nextLessonId, State.userData, {
                updateUserMeta: true,
                incrementCount: true
            }).then(progressResult => {
                // Update State with the new calculated numbers
                State.dayCount = progressResult.newDayCount;
                State.currentStreak = progressResult.newStreak;

                // Update the UI spans in the header
                updateActivityDisplay(State.dayCount, State.currentStreak);
            });
        };

        try { hideWebcamPreview(); } catch (error) { }

    } else if (question.inputType === "multi") {
        const answers = [question.cue, ...question.incues];
        question.alpha ? sortAnswersAlphabetically(answers) : shuffleArray(answers);

        renderMultiChoiceUI(
            Strings.get('btn_not_sure', State.userData?.native_language) || "I'm not sure",
            (val, btn) => submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, undefined, { pauseCount: null, netDuration: null }),
            answers,
            (answer, button) => submitAnswerPrecheck(answer, question.cue, question, button, question.explanation, question.translation, { pauseCount: null, netDuration: null })
        );
    }
}

function getNextQuestion(currentQuestion) {
    if (!State.configData || !State.configData.lessons || State.currentLessonIndex >= State.configData.lessons.length) return null;
    const currentLesson = State.configData.lessons[State.currentLessonIndex];
    const currentIndex = currentLesson.questions.findIndex(q => q.question === currentQuestion.question && q.cue === currentQuestion.cue);
    if (currentIndex === -1) return currentLesson.questions[0];
    if (currentIndex >= currentLesson.questions.length - 1) return null;
    return currentLesson.questions[currentIndex + 1];
}

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
    updateCurrentScoreDisplay(State.currentPoints);

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
                State.dayCount = progressResult.newDayCount;
                updateDayCountDisplay(State.dayCount);
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

async function initializeLesson() {
    try {
        State.lessonId = await getCurrentLessonId();
        if (!State.configData || !State.configData.lessons) return;
        State.lesson = State.configData.lessons.find(lesson => lesson.lessonId === State.lessonId);
        if (!State.lesson) return;
        State.currentLessonIndex = State.configData.lessons.findIndex(l => l.lessonId === State.lessonId);

        if (window.preloadLessonAssets) {
            const constructFirebaseUrl = (slug) => `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${slug}.mp4?alt=media`;
            await window.preloadLessonAssets(State.lesson, constructFirebaseUrl);
        }

        loadLessonContent(State.lesson);
    } catch (error) {
        console.error("initializeLesson error:", error);
        const preloader = document.getElementById('appLoadingImageDiv');
        if (preloader) preloader.style.display = 'none';
        showErrorMessageInQuestionsContainer(Strings.get('lesson_load_error', State.userData?.native_language));
    }
}


function loadLessonContent(lesson) {
    clearSpeechRecordingsForLesson(lesson.lessonId).catch(e => console.error(e));
    if (State.player) State.player.destroy();

    State.resetForNewLesson();
    State.mission = lesson.mission || "";
    State.setting = lesson.setting || "";
    State.userRole = lesson.userRole || "";
    State.videoRole = lesson.videoRole || "";

    updateCurrentScoreDisplay(State.currentPoints);
    updateActivityDisplay(State.dayCount, State.currentStreak);

    resetHeartsUI();

    updateProgressBar();

    // --- TITLE LOGIC ---
    const course = State.configData?.courseName || "";
    const level = State.englishLevel ? ` (${State.englishLevel})` : "";
    const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
    const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
    const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

    setupLessonUI(fullTitle);

    loadQuestion(lesson.questions[State.currentQuestionIndex], lesson);
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
        authLink.textContent = 'Sign Out';
    } else {
        authLink.textContent = 'Sign In';
    }

    authLink.removeEventListener('click', handleAuthClick);
    authLink.addEventListener('click', handleAuthClick);
}

// 🚀🚀🚀🚀🚀🚀🚀🚀 INITIALIZE APP 🚀🚀🚀🚀🚀🚀🚀🚀

async function initializeApp() {
    try {
        requestPersistentStorage();
        const isLoggedIn = await isUserLoggedIn();
        setupAuthMenu(isLoggedIn);

        State.userData = await getUserProfile();

        if (!isLoggedIn) {
            console.warn('User not authenticated. Proceeding as guest.');
            showGuestLoginModal();
        }
        State.initializeUserMetrics(State.userData, calculateCurrentStreak);

        updateActivityDisplay(State.dayCount, State.currentStreak);

        // Immediately trigger offline score sync if needed
        syncOfflineScores(State.userData);

        State.courseId = await getCurrentcourseId();

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
                Object.assign(State, newState);
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
                    const speechModuleUrl = new URL('modules/speech.js?8', scriptDir).href;
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