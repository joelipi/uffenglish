// --- components/question-loader.web.js ---
// Web-specific question rendering. Dispatches on question.inputType and renders
// the appropriate UI using DOM helpers from ui.js.
// React Native counterpart would use navigation + JSX components.

import { State } from '../modules/state.js';
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { loadVideoForQuestion } from '../modules/video-loader.js';
import { Media } from '../modules/media.js';
import {
    getCurrentQuestionIndex,
} from '../modules/answers.js';
import {
    isIOS,
    warmUpSpeechCamStream,
    toggleSpeechRecognition,
} from '../modules/speech.js';
import { initVideoProcessor } from '../modules/video-processor.js';
import { saveLessonProgress } from '../modules/user-profile.js';
import { getCompressedLessonStats } from '../modules/scoring.js';
import { pointLoss } from './point-loss-animation.js';

import {
    DOM,
    clearChatInterface,
    resetUIForNewQuestion,
    clearPlaybackVideo,
    toggleScoresAndHearts,
    hideWebcamPreview,
    removeRepeatButton,
    prepareMediaUI,
    clearMediaContainerAndPreservePlayers,
    renderImageInMediaContainer,
    renderYoutubeInMediaContainer,
    setMicStatusText,
    resetAnswersContainer,
    hideHints,
    showHintsAndScroll,
    renderSpeechInputUI,
    renderTextInputUI,
    updateProgressAndCloseButton,
    setProgressBarWidth,
    hideAnswerDiv,
    bindProcessButton,
    renderMultiChoiceUI,
    renderAIFeedback,
} from './ui.js';

// Commented out during development; will be added back in production to prevent accidental data loss.
function beforeUnloadHandler(e) { /* e.preventDefault(); e.returnValue = ''; return ''; */ }

/**
 * Renders a question by dispatching on its inputType.
 * This is the web-specific view controller for the lesson flow.
 *
 * @param {Object} question - The question data object
 * @param {Object} lesson - The current lesson object
 * @param {*} fluencyData - Fluency data (passed through to success handler)
 * @param {Object} deps - Injected dependencies to avoid circular imports
 * @param {Function} deps.submitAnswerPrecheck - Answer submission handler
 * @param {Function} deps.showFeedbackAndProceed - Feedback + advance handler
 * @param {Function} deps.handleHint - Hint display handler
 */
export function loadQuestion(question, lesson, fluencyData, deps) {
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint } = deps;

    // --- Common setup for ALL question types ---
    window.__currentQuestionIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);
    clearChatInterface(); // Clear FIRST so the card collapses before we scroll
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewQuestion(question.inputType === 'lessonIntro', !!State.userData);

    Media.cleanupPreviousPlayers();
    clearPlaybackVideo();

    toggleScoresAndHearts((question.inputType === 'speech' || question.inputType === 'ai') && question.videoUrl);

    if (question.inputType === 'speech' || question.inputType === 'ai') {
        if (!State.isCameraOff && !State.isTextMode) {
            warmUpSpeechCamStream();
        } else if (State.isTextMode) {
            // Text mode: bypass hardware prompt completely
            console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
        } else {
            warmUpSpeechCamStream(); // For audio-only mode, the mock stream handles this
        }
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
        if (!State.isCameraOff && !State.isTextMode) {
            warmUpSpeechCamStream();
        } else if (State.isTextMode) {
            // Text mode: bypass hardware prompt completely
            console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
        } else {
            warmUpSpeechCamStream(); // For audio-only mode, the mock stream handles this
        }
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

    // --- InputType dispatch ---
    if (question.inputType === "speech" || question.inputType === "ai") {
        _renderSpeechOrAI(question, lesson, deps);

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
        _renderLessonIntro(question, lesson, showFeedbackAndProceed);

    } else if (question.inputType === 'present') {
        _renderPresent(question, lesson, showFeedbackAndProceed);

    } else if (question.inputType === 'success') {
        _renderSuccess(question, fluencyData);

    } else if (question.inputType === "multi") {
        const answers = [question.cue, ...question.incues];
        // Sorting functionality removed per request

        renderMultiChoiceUI(
            Strings.get('btn_not_sure', State.userData?.native_language) || "I'm not sure",
            (val, btn) => submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, undefined, { pauseCount: null, netDuration: null }),
            answers,
            (answer, button) => submitAnswerPrecheck(answer, question.cue, question, button, question.explanation, question.translation, { pauseCount: null, netDuration: null })
        );
    }
}

// --- Private helpers for each inputType branch ---

function _renderSpeechOrAI(question, lesson, deps) {
    const { submitAnswerPrecheck, handleHint } = deps;
    hideHints();

    const allHidden = false; let revealedFirst = false;
    const escapeHtml = (text) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    };

    const answerFragment = document.createDocumentFragment();
    // Add possible answers directly if not speech
    if (question.inputType !== "speech") {
        answerFragment.appendChild(document.createTextNode(question.cue));
        if (question.possibleAnswer) {
            answerFragment.appendChild(document.createElement('br'));
            const strong = document.createElement('strong');
            strong.textContent = Strings.get('possible_response', State.userData?.native_language);
            answerFragment.appendChild(strong);
            answerFragment.appendChild(document.createElement('br'));
            answerFragment.appendChild(document.createTextNode(question.possibleAnswer));
        }
    }

    const handleRevealClick = function () {
        // Handled by IVP internally
    };

    const qIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);

    if (State.isTextMode) {
        const placeholder = Strings.get('placeholder_type_answer', State.userData?.native_language) || 'Type your answer here...';
        const submitLabel = Strings.get('btn_submit', State.userData?.native_language) || 'Submit';
        renderTextInputUI(placeholder, submitLabel, (val, btn) => {
            submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, question.translation, { pauseCount: 0, netDuration: 3 });
        });
    } else {
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
    }
}

function _renderLessonIntro(question, lesson, showFeedbackAndProceed) {
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
}

function _renderPresent(question, lesson, showFeedbackAndProceed) {
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
}

function _renderSuccess(question, fluencyData) {
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
        const finalStats = getCompressedLessonStats();

        saveLessonProgress(State.courseId, nextLessonId, State.userData, {
            updateUserMeta: true,
            incrementCount: true,
            lessonStats: finalStats,
            currentLessonId: question.lessonId
        }).then(progressResult => {
            // Update the store with the new calculated numbers; subscription handles the UI
            appStore.getState().setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
        });
    };

    try { hideWebcamPreview(); } catch (error) { }
}
