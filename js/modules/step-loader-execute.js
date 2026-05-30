// --- modules/step-loader-execute.js ---
// Exports createLoadStep(deps) factory.
// UI rendering is driven through Zustand store actions — React components handle the DOM.

import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { getCurrentStepIndex } from '../modules/answers.js';
import { logInteraction } from '../modules/scoring.js';
import { handleTextStep, handleLessonComplete, handleUnitComplete, handleSuccessStep, clearWarningLater, cancelWarningClear } from '../modules/step-loader-logic.js';
import { loadStepOrchestrate } from '../modules/step-loader-orchestrate.js';

function resetUIForNewStep(isLessonIntro, hasUserData) {
    appStore.getState().setBottomControlState('mic');
}

export function createLoadStep(deps) {
    const {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint,
        warmUpSpeechCam,
        toggleSpeechRecognition,
        listeningState,
        clearChat,
        addAIFeedbackMessages,
    } = deps;

    return function loadStep(step, lesson, fluencyData) {

    // Strict voice/hesitation state isolation between steps
    if (listeningState) {
        listeningState.active = false;
        listeningState.transitioning = false;
        if (listeningState.hesitationTimer) {
            clearInterval(listeningState.hesitationTimer);
            listeningState.hesitationTimer = null;
        }
    }

    clearChat();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewStep(step.stepType === 'lessonIntro', !!appStore.getState().userData);

    // Platform-specific pre-dispatch: speech warmup, media rendering, UI setup
    const onStepLoaded = (step, lesson, fluencyData) => {
        if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
            if (!appStore.getState().isCameraOff && !appStore.getState().isTextMode) {
                warmUpSpeechCam();
            } else if (appStore.getState().isTextMode) {
                console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
            } else {
                warmUpSpeechCam();
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
        _renderResponseStep(step, lesson, deps, toggleSpeechRecognition);
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
        _renderPresent(step, lesson, deps.showFeedbackAndProceed, addAIFeedbackMessages);
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

function _renderResponseStep(step, lesson, deps, toggleSpeechRecognition) {
    const { submitAnswerPrecheck, handleHint } = deps;
    appStore.getState().setHintsVisible(false);

    if (step.stepType !== "closedResponse") {
        appStore.getState().setSpeechCue(step.cue);
        appStore.getState().setSpeechPossibleAnswer(step.possibleAnswer || null);
    }

    const stepIndex = getCurrentStepIndex(step, appStore.getState().configData, appStore.getState().currentLessonIndex);

    if (appStore.getState().isTextMode) {
        appStore.getState().setStatsVisible(true);
        const placeholder = Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...';
        appStore.getState().setTextInputPlaceholder(placeholder);
        appStore.getState().setTextInputSubmitCallback((val, btn) => {
            submitAnswerPrecheck(val, step.cue, step, btn, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 });
        });
    } else {
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
                            appStore.getState().triggerPointLoss('flow', points);
                        },
                        onPauseVideo: (player) => {
                            try {
                                if (player && typeof player.pause === 'function') {
                                    player.pause();
                                }
                            } catch (e) {
                                console.warn('[QuestionLoader] Failed to pause player object:', e);
                            }
                            appStore.getState().triggerPauseAllVideos();
                        },
                        onMicDisable: () => {
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
                            appStore.getState().setMicStatus({ type: 'speak-now', bilingual: Strings.getBilingual('status_speak', userData?.native_language) });
                        },
                        onEngineNotReady: (userData) => {
                            const errorMsg = Strings.get('error_engine_not_ready', userData?.native_language) || "Speech engine not ready. Please wait a moment.";
                            appStore.getState().setMicStatus({ type: 'engine-error', text: errorMsg });
                        },
                        onEngineReady: (btn) => {
                            if (btn) {
                                btn.disabled = false;
                            }
                            appStore.getState().setMicStatus({ type: 'engine-ready', text: 'Engine ready. Try speaking now!' });
                        },
                        onRecordingActive: () => {
                        },
                        onRecordingStop: (btn) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().setMicStatus(null);
                            appStore.getState().setMediaVisible(false);
                            appStore.getState().setTextInputVisible(false);
                            appStore.getState().setMicStatus({ type: 'analyzing', text: 'Analyzing Speech...' });
                        },
                        onStopEarly: (userData) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setPointLossAmount(10);
                            appStore.getState().setMediaVisible(true);
                            appStore.getState().setMicStatus({ type: 'stop-early', text: Strings.get('try_again_speech', userData?.native_language) });
                            clearWarningLater(3000);
                        },
                        onGibberishDetected: () => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setPointLossAmount(10);
                            appStore.getState().setMicStatus({ type: 'gibberish', text: 'Audio unclear. Please try speaking clearly.' });
                            clearWarningLater(3000);
                        },
                        onPreflightRejected: (msg) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().deductSpeakingScore(10);
                            appStore.getState().incrementWhisperRejections();
                            appStore.getState().triggerVideoClear();
                            appStore.getState().setWebcamStream(null);
                            appStore.getState().triggerPreflightRejected();
                            appStore.getState().setPointLossAmount(10);
                            appStore.getState().setMicStatus({ type: 'preflight-rejected', text: msg });
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
                            appStore.getState().setPointLossAmount(20);
                            appStore.getState().setMicStatus({ type: 'restarting', text: 'Restarting Mic...' });
                        },
                        onReviewStart: (transcript, timeLeft, acceptFn, rejectFn) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().removeAiLoadingMessage();
                            appStore.getState().setMicStatus(null);
                            appStore.getState().setWhisperReviewData({ transcript, timeLeft, onAccept: acceptFn, onReject: rejectFn });
                            appStore.getState().setWhisperReviewTimeLeft(timeLeft);
                        },
                        onReviewUpdate: (timeLeft) => {
                            appStore.getState().setWhisperReviewTimeLeft(timeLeft);
                        },
                        onReviewEnd: () => {
                            appStore.getState().setWhisperReviewData(null);
                            appStore.getState().setWhisperReviewTimeLeft(null);
                            appStore.getState().setMicStatus(null);
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

function _renderPresent(step, lesson, showFeedbackAndProceed, addAIFeedbackMessages) {
    appStore.getState().setStatsVisible(false);

    if (!step.simpleVideoUrl) {
        const messages = [];

        if (step.explanations && Array.isArray(step.explanations)) {
            step.explanations.forEach(chunk => {
                if (chunk.type === 'grammar_diff') {
                    messages.push({
                        role: 'system',
                        type: 'grammarDiff',
                        score: chunk.score || 100,
                        errorCount: chunk.errorCount || 0,
                        complexityScore: chunk.complexityScore || 100,
                        original: chunk.original,
                        correction: chunk.corrected || chunk.correction
                    });
                } else if (chunk.type === 'pragmatics') {
                    messages.push({
                        role: 'system',
                        type: 'pragmatics',
                        header: chunk.header,
                        correction: chunk.correction
                    });
                } else if (chunk.type === 'raw' || chunk.type === 'message') {
                    messages.push({
                        role: 'system',
                        type: 'standard',
                        content: chunk.content || chunk.message
                    });
                }
            });
        } else if (step.explanation) {
            const lang = appStore.getState().userData?.native_language;
            const expTrans = getLocalizedTranslation(step.translation, lang);
            messages.push({
                role: 'system',
                type: 'standard',
                content: step.explanation,
                translation: expTrans,
                translationLang: (expTrans && lang && lang !== 'en') ? lang : undefined
            });
        }

        if (messages.length > 0) {
            addAIFeedbackMessages(messages);
        }
    }
    showFeedbackAndProceed(step, true);
}

function _renderSuccess(step, fluencyData) {
    step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId;

    handleSuccessStep(step, fluencyData);
}

function _renderLessonIntro(step, lesson, deps) {
    const { showFeedbackAndProceed } = deps;
    appStore.getState().setStatsVisible(false);
    appStore.setState({ repeatPointsHistory: [] });
    appStore.setState({ rolePlayPointsHistory: [] });

    showFeedbackAndProceed(step, true);
}
