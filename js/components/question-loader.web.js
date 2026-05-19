// --- components/question-loader.web.js ---
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
    listeningState,
} from '../modules/speech.js';
import { processVideo } from '../modules/video-processor.js';
import { saveLessonProgress } from '../modules/user-profile.js';
import { getCompressedLessonStats } from '../modules/scoring.js';
import { pointLoss } from '../components/point-loss-animation.js';

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
    clearMicStatusAndHideMedia,
    removeWebcamPreview,
    renderWhisperReviewUI,
    updateWhisperTimer,
    showContinueButton,
    hideContinueButton
} from './ui.js';

function beforeUnloadHandler(e) { /* e.preventDefault(); e.returnValue = ''; return ''; */ }

export function loadQuestion(question, lesson, fluencyData, deps) {
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint } = deps;

    // Strict voice/hesitation state isolation between questions
    if (listeningState) {
        listeningState.active = false;
        listeningState.transitioning = false;
        if (listeningState.hesitationTimer) {
            clearInterval(listeningState.hesitationTimer);
            listeningState.hesitationTimer = null;
        }
    }

    window.__currentQuestionIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);
    clearChatInterface();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewQuestion(question.inputType === 'lessonIntro', !!State.userData);

    Media.cleanupPreviousPlayers();
    State.player = null;
    clearPlaybackVideo();

    toggleScoresAndHearts((question.inputType === 'closedResponse' || question.inputType === 'openResponse') && question.videoUrl);

    if (question.inputType === 'closedResponse' || question.inputType === 'openResponse') {
        if (!State.isCameraOff && !State.isTextMode) {
            warmUpSpeechCamStream();
        } else if (State.isTextMode) {
            console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
        } else {
            warmUpSpeechCamStream();
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

    if (question.inputType === "closedResponse" || question.inputType === "openResponse") {
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
        _renderLessonIntro(question, lesson, deps);
    } else if (question.inputType === 'present') {
        _renderPresent(question, lesson, showFeedbackAndProceed);
    } else if (question.inputType === 'success') {
        _renderSuccess(question, fluencyData);
    }
}

function _renderSpeechOrAI(question, lesson, deps) {
    const { submitAnswerPrecheck, handleHint } = deps;
    hideHints();

    const answerFragment = document.createDocumentFragment();
    if (question.inputType !== "closedResponse") {
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

    const handleRevealClick = function () { };

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
            question.inputType === "closedResponse" ? null : () => handleHint(qIndex),
            handleRevealClick,
            async () => {
                const speechButton = document.getElementById('micBtn');

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
                        player: State.player,
                        uiHooks: {
                            onHesitation: (points) => {
                                const scoreEl = document.getElementById('flowScore');
                                if (scoreEl && pointLoss) {
                                    pointLoss.show(scoreEl, points);
                                }
                            },
                            onPauseVideo: (player) => {
                                try {
                                    if (player && typeof player.pause === 'function') {
                                        player.pause();
                                    }
                                } catch (e) {
                                    console.warn('[QuestionLoader] Failed to pause player object:', e);
                                }
                                Media.pauseVideoIfPlaying();
                            },
                            onMicDisable: (btn) => {
                                window.isMicActive = false; // Release the lock
                                if (btn) {
                                    btn.classList.add('toggled-off');
                                    btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                                    stopMicAnimation(btn);
                                }
                            },
                            onRecordingStart: (userData) => {
                                window.isMicActive = true; // Lock the video timer
                                if (window.currentVideoPlayer) {
                                    if (typeof window.currentVideoPlayer.pause === 'function') {
                                        window.currentVideoPlayer.pause();
                                    } else if (window.currentVideoPlayer.video) {
                                        window.currentVideoPlayer.video.pause();
                                    }
                                }
                                setMicStatusText(`<div class="text-center"><div class="mb-0" style="color: green; font-size: 30px;"><i class="bi bi-mic" style="color: green; font-size: 100px !important;"></i><br>${Strings.get('status_speak', userData?.native_language)}</div></div>`);
                            },
                            onEngineNotReady: (userData) => {
                                const errorMsg = Strings.get('error_engine_not_ready', userData?.native_language) || "Speech engine not ready. Please wait a moment.";
                                setMicStatusText(`<div class='text-center text-danger' style="color: red; font-size: 30px;"><i class="bi bi-exclamation-triangle"></i> ${errorMsg}</div>`);
                            },
                            onEngineReady: (btn) => {
                                if (btn) {
                                    btn.style.display = "flex";
                                    btn.disabled = false;
                                    btn.classList.add('toggled-off');
                                    btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                                }
                                setMicStatusText(`<div class='text-center text-success mt-2'><i class="bi bi-check-circle"></i> Engine ready. Try speaking now!</div>`);
                            },
                            onRecordingActive: (btn) => {
                                if (btn) {
                                    btn.style.display = "flex";
                                    btn.innerHTML = '<i class="bi bi-mic-fill"></i>';
                                    btn.classList.remove('toggled-off', 'btn-danger', 'disabled');
                                    startMicAnimation(btn);
                                }
                            },
                            onRecordingStop: (btn) => {
                                window.isMicActive = false; // Release the lock
                                if (btn) {
                                    btn.style.display = 'none';
                                    stopMicAnimation(btn);
                                }
                                clearMicStatusAndHideMedia();
                                setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`);
                            },
                            onStopEarly: (userData) => {
                                window.isMicActive = false; // Release the lock
                                window.dispatchEvent(new CustomEvent('preflightRejected'));
                                prepareMediaUI();
                                setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
                                const btn = document.getElementById('micBtn');
                                if (btn) btn.style.display = 'flex';
                            },
                            onGibberishDetected: () => {
                                window.isMicActive = false; // Release the lock
                                window.dispatchEvent(new CustomEvent('preflightRejected'));
                                setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);
                            },
                            onPreflightRejected: (msg) => {
                                window.isMicActive = false; // Release the lock
                                clearPlaybackVideo();
                                removeWebcamPreview();
                                window.dispatchEvent(new CustomEvent('preflightRejected'));
                                setMicStatusText(`<div class='text-center text-danger'>${msg}</div>`);
                                const btn = document.getElementById('micBtn');
                                if (btn) {
                                    btn.style.display = 'flex';
                                    stopMicAnimation(btn);
                                }
                            },
                            onTranscriptRejected: (cue, transcript) => {
                                window.isMicActive = false; // Release the lock
                                clearPlaybackVideo();
                                removeWebcamPreview();
                                window.dispatchEvent(new CustomEvent('transcriptRejected', { detail: { cue, transcript } }));
                                setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`);
                                const btn = document.getElementById('micBtn');
                                if (btn) {
                                    btn.style.display = 'flex';
                                    stopMicAnimation(btn);
                                }
                            },
                            onReviewStart: (transcript, timeLeft, acceptFn, rejectFn) => {
                                window.isMicActive = false; // Release the lock
                                renderWhisperReviewUI(transcript, timeLeft, acceptFn, rejectFn);
                            },
                            onReviewUpdate: (timeLeft) => {
                                updateWhisperTimer(timeLeft);
                            },
                            onReviewEnd: () => {
                                setMicStatusText("");
                            }
                        }
                    });
                } catch (error) {
                    console.error("Speech toggle failed", error);
                }
            }
        );
    }
}

function _renderPresent(question, lesson, showFeedbackAndProceed) {
    updateProgressAndCloseButton(false); toggleScoresAndHearts(false); hideAnswerDiv();

    let headsUpHTML = question.headsUp ? `<div class="chat-message-row chat-message-row--system"><div class="chat-message-bubble chat-message-bubble--system"><p class="headsUp mb-0">${question.headsUp}</p></div></div>` : "";

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

    window.__currentConfigData = State.configData;

    // initVideoProcessor was removed during index.html migration
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
            appStore.getState().setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
            if (progressResult.lessonsCompleted) {
                appStore.getState().setLessonsCompleted(progressResult.lessonsCompleted);
            }
        });
    };

    try { hideWebcamPreview(); } catch (error) { }
}

function _renderLessonIntro(question, lesson, deps) {
    const { showFeedbackAndProceed } = deps;
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

// --- LIQUID UI MIC ANIMATIONS ---
let micAnimations = [];

function startMicAnimation(btn) {
    if (!btn) return;
    const rings = btn.parentElement.querySelectorAll('.mic-ring');
    if (rings.length === 0) return;

    const duration = 2000;
    const delays = [0, 650, 1300];

    rings.forEach((ring, index) => {
        ring.style.opacity = '0.7';
        const anim = ring.animate([
            { transform: 'scale(1)', opacity: 0.7 },
            { transform: 'scale(2.6)', opacity: 0 }
        ], {
            duration: duration,
            delay: delays[index],
            iterations: Infinity,
            easing: 'ease-out'
        });
        micAnimations.push(anim);
    });
}

function stopMicAnimation(btn) {
    micAnimations.forEach(anim => anim.cancel());
    micAnimations = [];

    if (!btn) return;
    const rings = btn.parentElement.querySelectorAll('.mic-ring');
    rings.forEach(ring => {
        ring.style.opacity = '0';
        ring.style.transform = 'scale(1)';
    });
}
