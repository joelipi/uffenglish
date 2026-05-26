import { appStore } from '../modules/store.js';
import { loadStepOrchestrate } from '../modules/step-loader-orchestrate.js';
import {
    handleSuccessStep,
    clearWarningLater
} from '../modules/step-loader-logic.js';
import { getCurrentStepIndex } from '../modules/answers.js';
import {
    isIOS,
    warmUpSpeechCamStream,
    toggleSpeechRecognition
} from '../modules/speech.js';
import { Media } from '../modules/media.js';
import Strings from '../data/strings.js';

export function createLoadStep(submitAnswerPrecheck, showFeedbackAndProceed, handleHint, startMicAnimation, stopMicAnimation) {

    // ---------------------------------------------------------------------------
    // DOM helper: render Whisper transcript review UI
    // ---------------------------------------------------------------------------
    function renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject) {
        const container = document.getElementById('whisper-review-ui');
        if (!container) return;
        container.innerHTML = '';
        container.style.display = 'block';

        const transcriptEl = document.createElement('div');
        transcriptEl.className = 'whisper-review-transcript';
        transcriptEl.textContent = transcript;
        container.appendChild(transcriptEl);

        const timerEl = document.createElement('div');
        timerEl.className = 'whisper-review-timer';
        timerEl.textContent = `${timeLeft}s`;
        container.appendChild(timerEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'whisper-review-actions';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'btn btn-success whisper-review-accept';
        acceptBtn.textContent = '✓ Accept';
        acceptBtn.addEventListener('click', onAccept);
        actionsEl.appendChild(acceptBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-danger whisper-review-reject';
        rejectBtn.textContent = '✗ Reject';
        rejectBtn.addEventListener('click', onReject);
        actionsEl.appendChild(rejectBtn);

        container.appendChild(actionsEl);
    }

    // ---------------------------------------------------------------------------
    // DOM helper: update Whisper timer display
    // ---------------------------------------------------------------------------
    function updateWhisperTimer(timeLeft) {
        const timerEl = document.querySelector('.whisper-review-timer');
        if (timerEl) timerEl.textContent = `${timeLeft}s`;
    }

    // ---------------------------------------------------------------------------
    // DOM helper: reset UI for new step
    // ---------------------------------------------------------------------------
    function resetUIForNewStep(isLessonIntro, hasUserData) {
        const answerDiv = document.getElementById('answer-div');
        if (answerDiv) answerDiv.classList.add('d-none');

        const hintBtn = document.getElementById('hint-btn');
        if (hintBtn) hintBtn.classList.add('d-none');

        const repeatBtn = document.getElementById('repeat-btn');
        if (repeatBtn) repeatBtn.classList.add('d-none');

        const whisperReview = document.getElementById('whisper-review-ui');
        if (whisperReview) whisperReview.style.display = 'none';

        appStore.getState().setHangmanHintHTML('');
        appStore.getState().setHintsVisible(false);
        appStore.getState().setMicStatusText('');

        if (isLessonIntro) {
            appStore.getState().setBottomControlState('introChoices');
        } else {
            appStore.getState().setBottomControlState('mic');
        }

        const mediaViewport = document.getElementById('media-viewport');
        if (mediaViewport) mediaViewport.classList.remove('d-none');
    }

    // ---------------------------------------------------------------------------
    // DOM helper: clear media container, preserving player instances
    // ---------------------------------------------------------------------------
    function clearMediaContainerAndPreservePlayers() {
        const mediaViewport = document.getElementById('media-viewport');
        if (!mediaViewport) return;

        // Remove everything except elements we want to keep (video players)
        const children = Array.from(mediaViewport.children);
        children.forEach(child => {
            if (child.id && (currentVideoPlayerIds.has(child.id) || child.classList.contains('player-preserve'))) {
                return;
            }
            child.remove();
        });
    }

    const currentVideoPlayerIds = new Set(['playback-video']);

    // ---------------------------------------------------------------------------
    // DOM helper: show media viewport, hide intro call widget
    // ---------------------------------------------------------------------------
    function showMediaViewport() {
        const mediaViewport = document.getElementById('media-viewport');
        if (mediaViewport) mediaViewport.classList.remove('d-none');
        const introCallWidget = document.getElementById('intro-call-widget');
        if (introCallWidget) introCallWidget.classList.remove('d-none');
    }

    // ---------------------------------------------------------------------------
    // DOM helper: hide media viewport, show intro call widget
    // ---------------------------------------------------------------------------
    function hideMediaViewport() {
        const mediaViewport = document.getElementById('media-viewport');
        if (mediaViewport) mediaViewport.classList.add('d-none');
        const introCallWidget = document.getElementById('intro-call-widget');
        if (introCallWidget) introCallWidget.classList.add('d-none');
    }

    // ---------------------------------------------------------------------------
    // DOM helper: render image in media container
    // ---------------------------------------------------------------------------
    function renderImageInMediaContainer(imageUrl) {
        const mediaViewport = document.getElementById('media-viewport');
        if (!mediaViewport) return;

        clearMediaContainerAndPreservePlayers();

        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'img-fluid step-image';
        img.alt = 'Step image';
        mediaViewport.appendChild(img);

        showMediaViewport();
    }

    // ---------------------------------------------------------------------------
    // DOM helper: render YouTube embed in media container
    // ---------------------------------------------------------------------------
    function renderYoutubeInMediaContainer(youtubeId) {
        const mediaViewport = document.getElementById('media-viewport');
        if (!mediaViewport) return;

        clearMediaContainerAndPreservePlayers();

        const wrapper = document.createElement('div');
        wrapper.className = 'ratio ratio-16x9';

        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube.com/embed/${youtubeId}`;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');

        wrapper.appendChild(iframe);
        mediaViewport.appendChild(wrapper);

        showMediaViewport();
    }

    // ---------------------------------------------------------------------------
    // DOM helper: update progress bar and close button
    // ---------------------------------------------------------------------------
    function updateProgressAndCloseButton(showClose) {
        const currentLesson = appStore.getState().configData?.lessons?.[appStore.getState().currentLessonIndex];
        if (!currentLesson) return;

        const totalSteps = currentLesson.steps.length;
        const currentStepIndex = appStore.getState().currentStepIndex;
        const progress = Math.min(Math.max(((currentStepIndex + 1) / totalSteps) * 100, 1), 99);
        appStore.getState().setProgressPercent(`${progress}%`);

        const closeBtn = document.getElementById('close-btn');
        if (closeBtn) {
            if (showClose) closeBtn.classList.remove('d-none');
            else closeBtn.classList.add('d-none');
        }
    }

    // ---------------------------------------------------------------------------
    // DOM helper: hide answer div
    // ---------------------------------------------------------------------------
    function hideAnswerDiv() {
        const answerDiv = document.getElementById('answer-div');
        if (answerDiv) answerDiv.classList.add('d-none');
    }

    // ---------------------------------------------------------------------------
    // DOM helper: remove repeat button
    // ---------------------------------------------------------------------------
    function removeRepeatButton() {
        const repeatBtn = document.getElementById('repeat-btn');
        if (repeatBtn) repeatBtn.remove();
    }

    // ---------------------------------------------------------------------------
    // DOM helper: bind process button click
    // ---------------------------------------------------------------------------
    function bindProcessButton(onClickCallback) {
        const processBtn = document.getElementById('process-btn');
        if (!processBtn) return;

        // Remove old listeners by cloning
        const newBtn = processBtn.cloneNode(true);
        processBtn.parentNode.replaceChild(newBtn, processBtn);
        newBtn.addEventListener('click', onClickCallback);
    }

    // ---------------------------------------------------------------------------
    // onStepLoaded callback: speech warmup, media rendering, UI reset
    // ---------------------------------------------------------------------------
    function onStepLoaded(step, lesson, fluencyData) {
        console.log('[onStepLoaded] stepType:', step.stepType, 'step:', step.step);

        const isLessonIntro = step.stepType === 'lessonIntro';
        const hasUserData = !!appStore.getState().userData;

        resetUIForNewStep(isLessonIntro, hasUserData);

        if (isIOS) {
            warmUpSpeechCamStream();
        }

        if (step.imageUrl) {
            renderImageInMediaContainer(step.imageUrl);
        } else if (step.youtubeId) {
            renderYoutubeInMediaContainer(step.youtubeId);
        }

        updateProgressAndCloseButton(false);

        appStore.getState().setMicStatusText(step.step || '');
    }

    // ---------------------------------------------------------------------------
    // onResponseStep callback: speech recognition pipeline wiring
    // ---------------------------------------------------------------------------
    function onResponseStep(step, lesson, { submitAnswerPrecheck, showFeedbackAndProceed, handleHint }) {
        console.log('[onResponseStep] stepType:', step.stepType, 'step:', step.step);

        const configData = appStore.getState().configData;
        const userData = appStore.getState().userData;
        const currentLessonIndex = appStore.getState().currentLessonIndex;
        const currentStepIndex = appStore.getState().currentStepIndex;
        const micStatusEl = document.getElementById('mic-status');

        appStore.getState().setMediaVisible(true);
        showMediaViewport();

        const cueText = typeof step.cue === 'object' ? step.cue?.en : step.cue;
        const lang = userData?.native_language || 'en';

        appStore.getState().setMicStatusText(step.step || cueText || '');

        if (step.stepType === 'closedResponse') {
            appStore.getState().setMediaVisible(true);
        }

        const btn = document.getElementById('mic-btn') || document.getElementById('process-btn');
        if (btn) {
            appStore.getState().setOnMicClickCallback(() => {
                toggleSpeechRecognition({
                    button: btn,
                    step: step,
                    micStatusText: micStatusEl,
                    userData: userData,
                    configData: configData,
                    currentLessonIndex: currentLessonIndex,
                    currentStepIndex: currentStepIndex,
                    player: appStore.getState().currentVideoPlayer,
                    uiHooks: {
                        onPauseVideo: (player) => {
                            if (player && typeof player.pause === 'function') {
                                player.pause();
                            }
                        },
                        onRecordingStart: (userData) => {
                            console.log('[Speech] Recording started');
                            if (btn && startMicAnimation) startMicAnimation(btn);
                        },
                        onRecordingStop: (button) => {
                            console.log('[Speech] Recording stopped');
                            if (button && stopMicAnimation) stopMicAnimation(button);
                        },
                        onRecordingActive: (button) => {
                            console.log('[Speech] Recording active');
                        },
                        onMicDisable: (button) => {
                            if (button) button.disabled = true;
                        },
                        onEngineNotReady: (userData) => {
                            const msg = Strings.get('error_engine_not_ready', userData?.native_language) || 'Speech engine not ready. Please wait a moment.';
                            appStore.getState().setMicStatusText(`<div class='text-center text-warning'>${msg}</div>`);
                        },
                        onEngineReady: (button) => {
                            if (button) button.disabled = false;
                        },
                        onStopEarly: (userData) => {
                            console.log('[Speech] Stopped early — no transcript');
                        },
                        onGibberishDetected: () => {
                            console.log('[Speech] Gibberish detected');
                            const msg = Strings.get('error_speech_generic', userData?.native_language) || 'Speech recognition error.';
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${msg}</div>`);
                            clearWarningLater(3000);
                        },
                        onReviewStart: (transcript, timeLeft, onAccept, onReject) => {
                            console.log('[Speech] Review started:', transcript);
                            renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject);
                        },
                        onReviewUpdate: (timeLeft) => {
                            updateWhisperTimer(timeLeft);
                        },
                        onReviewEnd: () => {
                            const container = document.getElementById('whisper-review-ui');
                            if (container) container.style.display = 'none';
                        },
                        onPreflightRejected: (warningMessage) => {
                            console.log('[Speech] Preflight rejected:', warningMessage);
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${warningMessage}</div>`);
                            clearWarningLater(3000);
                        },
                        onTranscriptRejected: (cue, transcript) => {
                            console.log('[Speech] Transcript rejected:', transcript);
                            appStore.getState().triggerTranscriptRejected(cue, transcript);
                        },
                        onHesitation: (points) => {
                            console.log('[Speech] Hesitation detected, deducting', points);
                        }
                    }
                });
            });
        }

        if (step.stepType === 'closedResponse') {
            const repeatBtn = document.getElementById('repeat-btn');
            if (repeatBtn) {
                repeatBtn.classList.remove('d-none');
                repeatBtn.onclick = () => {
                    const player = appStore.getState().currentVideoPlayer;
                    if (player) {
                        if (player.video) player.video.currentTime = 0;
                        if (typeof player.play === 'function') {
                            player.play().catch(e => console.warn('Video play failed:', e));
                        }
                    }
                    appStore.getState().incrementVideoPlays();
                };
            }
        }

        const hintBtn = document.getElementById('hint-btn');
        if (hintBtn && step.stepType === 'openResponse') {
            hintBtn.classList.remove('d-none');
            hintBtn.onclick = () => handleHint(getCurrentStepIndex(step, configData, currentLessonIndex));
        }
    }

    // ---------------------------------------------------------------------------
    // onTextStep callback
    // ---------------------------------------------------------------------------
    function onTextStep(step, { submitAnswerPrecheck, showFeedbackAndProceed }) {
        console.log('[onTextStep] step:', step.step);

        appStore.getState().setMediaVisible(false);
        hideMediaViewport();

        const cueText = typeof step.cue === 'object' ? step.cue?.en : step.cue;
        const placeholder = Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...';

        appStore.getState().setTextInputVisible(true);
        appStore.getState().setTextInputPlaceholder(placeholder);
        appStore.getState().setTextInputSubmitCallback(
            (val, btn) => submitAnswerPrecheck(
                val,
                cueText,
                step,
                btn,
                step.explanation,
                step.translation,
                { pauseCount: null, netDuration: null }
            )
        );

        appStore.getState().setMicStatusText(step.step || '');
        appStore.getState().triggerInputFocus();
    }

    // ---------------------------------------------------------------------------
    // onLessonComplete callback
    // ---------------------------------------------------------------------------
    function onLessonComplete(step, { showFeedbackAndProceed }) {
        console.log('[onLessonComplete]');

        appStore.getState().setStatsVisible(false);
        appStore.getState().setProgressPercent("95%");
        appStore.getState().setMediaVisible(false);
        hideMediaViewport();

        showFeedbackAndProceed(step, true);
    }

    // ---------------------------------------------------------------------------
    // onUnitComplete callback
    // ---------------------------------------------------------------------------
    function onUnitComplete(step) {
        console.log('[onUnitComplete]');

        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
        step.lessonId = currentLesson.lessonId + 's';
        appStore.getState().successHandler.handleSuccessLesson(step);
    }

    // ---------------------------------------------------------------------------
    // onLessonIntro callback
    // ---------------------------------------------------------------------------
    function onLessonIntro(step, lesson, { showFeedbackAndProceed }) {
        console.log('[onLessonIntro] step:', step.step);

        appStore.getState().setMediaVisible(true);
        showMediaViewport();

        appStore.getState().setMicStatusText(step.step || '');

        if (step.introBackgroundVideoUrl) {
            // Video is loaded via the store by handleStepCore → loadVideoForStep
            // The React wrapper picks it up and renders the player
        }

        const onContinue = async () => {
            await Media.enableAudioSystem();
            await warmUpSpeechCamStream();
            appStore.getState().setBottomControlState('mic');
            appStore.getState().removeContinueWidget();
            setTimeout(() => {
                showFeedbackAndProceed(step, true);
            }, 2000);
        };

        appStore.getState().setIntroContinueCallback(onContinue);
        appStore.getState().setBottomControlState('introChoices');
    }

    // ---------------------------------------------------------------------------
    // onPresent callback
    // ---------------------------------------------------------------------------
    function onPresent(step, lesson, { showFeedbackAndProceed }) {
        console.log('[onPresent] step:', step.step);

        appStore.getState().setMediaVisible(true);
        showMediaViewport();

        appStore.getState().setMicStatusText(step.step || '');

        const onContinue = () => {
            appStore.getState().setBottomControlState('mic');
            appStore.getState().removeContinueWidget();
            showFeedbackAndProceed(step, true);
        };

        const hasWidget = appStore.getState().chatHistory.some(msg => msg.type === 'continueWidget');
        if (!hasWidget) {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'continueWidget',
                onClick: onContinue
            });
        }
    }

    // ---------------------------------------------------------------------------
    // onSuccess callback
    // ---------------------------------------------------------------------------
    function onSuccess(step, fluencyData) {
        console.log('[onSuccess]');

        handleSuccessStep(step, fluencyData);
    }

    // ---------------------------------------------------------------------------
    // Return the execute function
    // ---------------------------------------------------------------------------
    return function executeLoadStep(step, lesson, fluencyData) {
        console.log('[executeLoadStep] stepType:', step?.stepType, 'step:', step?.step);

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
