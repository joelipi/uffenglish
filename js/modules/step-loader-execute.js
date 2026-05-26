// --- modules/step-loader-execute.js ---
// Exports createLoadStep(submitAnswerPrecheck, showFeedbackAndProceed, handleHint) factory.
// UI rendering is driven through Zustand store actions — React components handle the DOM.

import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { formatBilingualHTML } from '../modules/bilingual-display.web.js';
import { Media } from '../modules/media.js';
import { getCurrentStepIndex } from '../modules/answers.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState } from '../modules/speech.js';
import { logInteraction } from '../modules/scoring.js';
import { pointLoss } from '../components/point-loss-animation.js';
import { handleTextStep, handleLessonComplete, handleUnitComplete, handleSuccessStep, clearWarningLater, cancelWarningClear } from '../modules/step-loader-logic.js';
import { loadStepOrchestrate } from '../modules/step-loader-orchestrate.js';
import { clearChat, addAIFeedbackMessages } from '../components/chat/chat-interface.js';

function resetUIForNewStep(isLessonIntro, hasUserData) {
    appStore.getState().setBottomControlState('mic');

    const resultVideo = document.getElementById('resultVideo');
    if (resultVideo) resultVideo.remove();
}

export function createLoadStep(submitAnswerPrecheck, showFeedbackAndProceed, handleHint) {
    return function loadStep(step, lesson, fluencyData) {
    // submitAnswerPrecheck, showFeedbackAndProceed, handleHint closed over from factory

    // Strict voice/hesitation state isolation between steps
    if (listeningState) {
        listeningState.active = false;
        listeningState.transitioning = false;
        if (listeningState.hesitationTimer) {
            clearInterval(listeningState.hesitationTimer);
            listeningState.hesitationTimer = null;
        }
    }

    window.__currentStepIndex = getCurrentStepIndex(step, appStore.getState().configData, appStore.getState().currentLessonIndex);
    clearChat();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewStep(step.stepType === 'lessonIntro', !!appStore.getState().userData);

    // Platform-specific pre-dispatch: speech warmup, media rendering, UI setup
    const onStepLoaded = (step, lesson, fluencyData) => {
        if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
            if (!appStore.getState().isCameraOff && !appStore.getState().isTextMode) {
                warmUpSpeechCamStream();
            } else if (appStore.getState().isTextMode) {
                console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
            } else {
                warmUpSpeechCamStream();
            }
        } else {
            appStore.getState().setWebcamStream(null);
        }

        if (step.image) {
            appStore.getState().setPraiseImageUrl(step.image);
        }
        if (step.youtube) {
            appStore.getState().setYoutubeVideoId(step.youtube);
        }
    };

    // Platform-specific step type handlers
    const onResponseStep = (step, lesson, deps) => {
        _renderResponseStep(step, lesson, deps);
    };

    const onTextStep = (step, deps) => {
        handleTextStep(step, deps.submitAnswerPrecheck);
    };

    const onLessonComplete = (step, deps) => {
        handleLessonComplete(step, deps.showFeedbackAndProceed);
    };

    const onUnitComplete = (step) => {
        handleUnitComplete(step);
    };

    const onLessonIntro = (step, lesson, deps) => {
        _renderLessonIntro(step, lesson, deps);
    };

    const onPresent = (step, lesson, deps) => {
        _renderPresent(step, lesson, deps.showFeedbackAndProceed);
    };

    const onSuccess = (step, fluencyData) => {
        _renderSuccess(step, fluencyData);
    };

    // Platform-agnostic orchestration
    loadStepOrchestrate(step, lesson, fluencyData, {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint,
        onStepLoaded,
        onResponseStep,
        onTextStep,
        onLessonIntro,
        onPresent,
        onSuccess,
        onLessonComplete,
        onUnitComplete
    });
    };
}

function _renderResponseStep(step, lesson, deps) {
    const { submitAnswerPrecheck, handleHint } = deps;
    appStore.getState().setHintsVisible(false);

    const answerFragment = document.createDocumentFragment();
    if (step.stepType !== "closedResponse") {
        const userLang = appStore.getState().userData?.native_language;
        const cueHTML = formatBilingualHTML(step.cue, userLang);
        const tempEl = document.createElement('span');
        tempEl.innerHTML = cueHTML;
        while (tempEl.firstChild) answerFragment.appendChild(tempEl.firstChild);
        if (step.possibleAnswer) {
            answerFragment.appendChild(document.createElement('br'));
            const strong = document.createElement('strong');
            strong.textContent = Strings.get('possible_response', appStore.getState().userData?.native_language);
            answerFragment.appendChild(strong);
            answerFragment.appendChild(document.createElement('br'));
            answerFragment.appendChild(document.createTextNode(step.possibleAnswer));
        }
    }

    const handleRevealClick = function () { };

    const stepIndex = getCurrentStepIndex(step, appStore.getState().configData, appStore.getState().currentLessonIndex);

    if (appStore.getState().isTextMode) {
        appStore.getState().setStatsVisible(true);
        const placeholder = Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...';
        appStore.getState().setTextInputPlaceholder(placeholder);
        appStore.getState().setTextInputSubmitCallback((val, btn) => {
            submitAnswerPrecheck(val, step.cue, step, btn, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 });
        });
    } else {
        const hintTempDiv = document.createElement('div');
        hintTempDiv.appendChild(answerFragment.cloneNode(true));
        appStore.getState().setSpeechInputContent(hintTempDiv.innerHTML);
        appStore.getState().setSpeechInputHintCallback(step.stepType === "closedResponse" ? null : () => handleHint(stepIndex));
        appStore.getState().setSpeechInputRevealCallback(handleRevealClick);
        appStore.getState().setSpeechInputToggleCallback(async () => {
            try {
                await toggleSpeechRecognition({
                    step,
                    userData: appStore.getState().userData,
                    configData: appStore.getState().configData,
                    currentLessonIndex: appStore.getState().currentLessonIndex,
                    currentStepIndex: stepIndex,
                    handleAnswer: submitAnswerPrecheck,
                    player: appStore.getState().currentVideoPlayer,
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
                            appStore.getState().setMicActive(false);
                        },
                        onRecordingStart: (userData) => {
                            cancelWarningClear();
                            appStore.getState().setMicActive(true);
                            if (appStore.getState().currentVideoPlayer) {
                                if (typeof appStore.getState().currentVideoPlayer.pause === 'function') {
                                    appStore.getState().currentVideoPlayer.pause();
                                } else if (appStore.getState().currentVideoPlayer.video) {
                                    appStore.getState().currentVideoPlayer.video.pause();
                                }
                            }
                            appStore.getState().setMicStatusText(`<div class="text-center"><div class="mb-0" style="color: green; font-size: 30px;"><i class="bi bi-mic" style="color: green; font-size: 100px !important;"></i><br>${Strings.get('status_speak', userData?.native_language)}</div></div>`);
                        },
                        onEngineNotReady: (userData) => {
                            const errorMsg = Strings.get('error_engine_not_ready', userData?.native_language) || "Speech engine not ready. Please wait a moment.";
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger' style="color: red; font-size: 30px;"><i class="bi bi-exclamation-triangle"></i> ${errorMsg}</div>`);
                        },
                        onEngineReady: (btn) => {
                            if (btn) {
                                btn.disabled = false;
                            }
                            appStore.getState().setMicStatusText(`<div class='text-center text-success mt-2'><i class="bi bi-check-circle"></i> Engine ready. Try speaking now!</div>`);
                        },
                        onRecordingActive: (btn) => {
                            if (btn) {
                            }
                        },
                        onRecordingStop: (btn) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().setMicStatusText("");
                            appStore.getState().setMediaVisible(false);
                            appStore.getState().setTextInputVisible(false);
                            appStore.getState().setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`);
                        },
                        onStopEarly: (userData) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setMediaVisible(true);
                            appStore.getState().setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
                            clearWarningLater(3000);
                        },
                        onGibberishDetected: () => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);
                            clearWarningLater(3000);
                        },
                        onPreflightRejected: (msg) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerVideoClear();
                            appStore.getState().setWebcamStream(null);
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${msg}</div>`);
                            clearWarningLater(4000);
                        },
                        onTranscriptRejected: (cue, transcript) => {
                            appStore.getState().setMicActive(false);
                            logInteraction(cue, transcript, "rej_usr", "User rejected Whisper transcription", null, appStore.getState().interactionLog);
                            appStore.getState().deductSpeakingScore(20);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerVideoClear();
                            appStore.getState().setWebcamStream(null);
                            appStore.getState().triggerTranscriptRejected(cue, transcript);
                            appStore.getState().setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`);
                        },
                        onReviewStart: (transcript, timeLeft, acceptFn, rejectFn) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().removeAiLoadingMessage();
                            appStore.getState().setMicStatusText("");
                            appStore.getState().setWhisperReviewData({ transcript, timeLeft, onAccept: acceptFn, onReject: rejectFn });
                            appStore.getState().setWhisperReviewTimeLeft(timeLeft);
                        },
                        onReviewUpdate: (timeLeft) => {
                            appStore.getState().setWhisperReviewTimeLeft(timeLeft);
                        },
                        onReviewEnd: () => {
                            appStore.getState().setMicStatusText("");
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

function _renderPresent(step, lesson, showFeedbackAndProceed) {
    appStore.getState().setStatsVisible(false);

    let headsUpHTML = step.headsUp ? `<div class="chat-message-row chat-message-row--system"><div class="chat-message-bubble chat-message-bubble--system"><p class="headsUp mb-0">${step.headsUp}</p></div></div>` : "";

    if (!step.simpleVideoUrl) {
        let explanationHTML = "";
        if (step.explanation) {
            const lang = appStore.getState().userData?.native_language;
            const expTrans = getLocalizedTranslation(step.translation, lang);
            const localized = expTrans && lang && lang !== 'en' ? `<br><br><span lang='${lang}'><i>${expTrans}</i></span>` : '';
            explanationHTML = `<p class='explanation'>${step.explanation}${localized}</p>`;
        }

        addAIFeedbackMessages([explanationHTML]);
    }
    showFeedbackAndProceed(step, true);
}

function _renderSuccess(step, fluencyData) {
    step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId;

    window.__currentConfigData = appStore.getState().configData;

    handleSuccessStep(step, fluencyData);
}

function _renderLessonIntro(step, lesson, deps) {
    const { showFeedbackAndProceed } = deps;
    appStore.getState().setStatsVisible(false);
    appStore.setState({ repeatPointsHistory: [] });
    appStore.setState({ rolePlayPointsHistory: [] });

    showFeedbackAndProceed(step, true);
}
