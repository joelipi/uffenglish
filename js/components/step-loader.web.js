// --- components/step-loader.web.js ---
// This file is deliberately kept as vanilla JS (not converted to React).
// Reason: _renderResponseStep wires up the speech recognition pipeline with
// 15+ imperative callbacks (onHesitation, onRecordingStart, onGibberishDetected,
// onTranscriptRejected, etc.) that manipulate DOM by ID and dispatch CustomEvents.
// The speech module (speech.js) is also vanilla and calls these synchronously.
// Converting would require rewriting the entire speech pipeline — not worth the
// risk mid-migration. This module works as a page controller alongside the React shell.

import { State } from '../modules/state.js';
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { formatBilingualHTML } from '../modules/bilingual-display.web.js';
import { loadVideoForStep } from '../modules/video-loader.js';
import { Media } from '../modules/media.js';
import {
    getCurrentStepIndex,
} from '../modules/answers.js';
import {
    isIOS,
    warmUpSpeechCamStream,
    toggleSpeechRecognition,
    listeningState,
} from '../modules/speech.js';
import { processVideo } from '../modules/video-processor.js';
import { pointLoss } from '../components/point-loss-animation.js';

import {
    handleStepCore,
    handleTextStep,
    handleLessonComplete,
    handleUnitComplete,
    handleSuccessStep,
    clearWarningLater,
    cancelWarningClear
} from '../modules/step-loader-logic.js';

import {
    clearChat,
    addAIFeedbackMessages
} from './chat/chat-interface.js';

function renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject) {
    appStore.getState().removeAiLoadingMessage();
    appStore.getState().setMicStatusText("");
    const container = document.getElementById('whisperReviewContainer');
    const transcriptEl = document.getElementById('whisperTranscript');
    if (!container || !transcriptEl) return;

    transcriptEl.textContent = `"${transcript}"`;
    const timerSpan = document.getElementById("reviewTimer");
    if (timerSpan) timerSpan.innerText = timeLeft;

    container.classList.remove("d-none");

    const bar = document.getElementById("reviewProgressBar");
    if (bar) {
        bar.style.transition = "none";
        bar.style.width = "100%";
        requestAnimationFrame(() => {
            bar.style.transition = "width 7s linear";
            bar.style.width = "0%";
        });
    }

    const acceptBtn = document.getElementById("acceptBtn");
    const rejectBtn = document.getElementById("rejectBtn");

    if (acceptBtn) {
        const newAccept = acceptBtn.cloneNode(true);
        acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
        newAccept.addEventListener("click", () => {
            container.classList.add("d-none");
            onAccept();
        });
    }

    if (rejectBtn) {
        const newReject = rejectBtn.cloneNode(true);
        rejectBtn.parentNode.replaceChild(newReject, rejectBtn);
        newReject.addEventListener("click", () => {
            container.classList.add("d-none");
            onReject();
        });
    }
}

function updateWhisperTimer(timeLeft) {
    const timerSpan = document.getElementById('reviewTimer');
    if (timerSpan) timerSpan.innerText = timeLeft;
}

function resetUIForNewStep(isLessonIntro, hasUserData) {
    appStore.getState().setBottomControlState('mic');

    const resultVideo = document.getElementById('resultVideo');
    if (resultVideo) resultVideo.remove();
    const displayCanvas = document.getElementById('displayCanvas');
    if (displayCanvas) displayCanvas.remove();

    const continueSuccess = document.getElementById('continueButtonSuccess');
    if (continueSuccess) continueSuccess.remove();

    const repeatSuccess = document.getElementById('repeatButtonSuccess');
    if (repeatSuccess) repeatSuccess.remove();

    const videoBtn = document.getElementById('processBtn') || document.getElementById('createVideoButton');
    if (videoBtn) {
        videoBtn.disabled = false;
        videoBtn.classList.remove('btn-success', 'flex-fill');
        videoBtn.classList.add('btn-outline-primary', 'w-100');
        videoBtn.innerHTML = '<i class="bi bi-film text-white"></i>';
    }

    const lessonIntroHeader = document.getElementById('lessonIntroHeader');
    if (lessonIntroHeader) lessonIntroHeader.classList.toggle('d-none', !isLessonIntro || hasUserData);

    if (document.getElementById('closeAndProgress')) document.getElementById('closeAndProgress').classList.toggle('d-none', isLessonIntro && !hasUserData);

    const myToastClose = document.querySelector('#myToast .btn-close');
    if (myToastClose) myToastClose.click();

    const successMedia = document.getElementById("success-media");
    if (successMedia) successMedia.classList.add("d-none");

    const courseProgress = document.getElementById("courseProgress");
    if (courseProgress) courseProgress.classList.add("d-none");

    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
        micBtn.style.removeProperty('display');
        micBtn.disabled = false;
        micBtn.classList.remove('disabled');
    }
    const txtBtn = document.getElementById('txtBtn');
    if (txtBtn) {
        txtBtn.style.removeProperty('display');
        txtBtn.disabled = false;
        txtBtn.classList.remove('disabled');
    }
}

function removeRepeatButton() {
    let repeatButton = document.getElementById('repeatButton');
    if (repeatButton) repeatButton.remove();
}

function clearMediaContainerAndPreservePlayers() {
    if (!document.getElementById('media-viewport')) return;

    const preserved = document.getElementById('media-viewport').querySelectorAll('#ivp-container, #simple-video-container, #intro-call-widget, #webcam-preview');
    document.getElementById('media-viewport').innerHTML = '';

    preserved.forEach(el => {
        el.style.display = '';
        el.style.minHeight = '';

        if (el.id === 'intro-call-widget') {
            el.classList.add('d-none');
        } else if (el.id === 'webcam-preview') {
        } else {
            el.classList.remove('d-none');
            if (el.id === 'ivp-container' || el.id === 'simple-video-container') {
                // React wrappers manage these containers via portal
            } else {
                el.innerHTML = '';
            }
        }

        document.getElementById('media-viewport').appendChild(el);
    });
}

function renderImageInMediaContainer(imageUrl) {
    if (!document.getElementById('media-viewport')) return;

    document.getElementById('media-viewport').classList.remove('d-none');
    document.getElementById('media-viewport').style.display = 'block';

    const existingPraise = document.getElementById('media-viewport').querySelectorAll('.praise-image-wrapper');
    existingPraise.forEach(el => el.remove());

    const div = document.createElement('div');
    div.className = 'text-center mb-3 praise-image-wrapper';
    div.innerHTML = `<img src="${imageUrl}" class="img-fluid rounded" alt="Praise" style="max-height: 250px; border: 3px solid #00f2fe; box-shadow: 0 0 15px rgba(0,242,254,0.5);">`;

    document.getElementById('media-viewport').prepend(div);
}

function renderYoutubeInMediaContainer(youtubeId) {
    if (!document.getElementById('media-viewport')) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<iframe width="315" height="560" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8" title="Intro" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    document.getElementById('media-viewport').prepend(div);
}

function updateProgressAndCloseButton(showClose) {
    if (document.getElementById('closeAndProgress')) {
        if (showClose) document.getElementById('closeAndProgress').classList.remove('d-none');
        else document.getElementById('closeAndProgress').classList.add('d-none');
    }
}

function hideAnswerDiv() {
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
}

function bindProcessButton(onClickCallback) {
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.addEventListener('click', onClickCallback);
}

function beforeUnloadHandler(e) { /* e.preventDefault(); e.returnValue = ''; return ''; */ }

export function loadStep(step, lesson, fluencyData, deps) {
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint } = deps;

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

    handleStepCore(step);

    if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
        if (!appStore.getState().isCameraOff && !appStore.getState().isTextMode) {
            warmUpSpeechCamStream();
        } else if (appStore.getState().isTextMode) {
            console.log('[QuestionLoader] Text mode: bypassing hardware prompt');
        } else {
            warmUpSpeechCamStream();
        }
        if (isIOS) {
            const closePageLink = document.getElementById('closePage');
            if (closePageLink) {
                closePageLink.removeEventListener('click', handleClosePageClick);
                function handleClosePageClick(e) { if (!confirm(Strings.get('alert_lesson_reset', appStore.getState().userData?.native_language))) e.preventDefault(); }
                closePageLink.addEventListener('click', handleClosePageClick);
            }
        } else {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            window.addEventListener('beforeunload', beforeUnloadHandler);
        }
    } else {
        appStore.getState().setWebcamStream(null);
        window.removeEventListener('beforeunload', beforeUnloadHandler);
    }

    if (step.stepType != 'lessonComplete' && step.stepType != 'unitComplete') {
        removeRepeatButton();
    }

    clearMediaContainerAndPreservePlayers();

    if (step.image) {
        renderImageInMediaContainer(step.image);
    }
    if (step.youtube) {
        renderYoutubeInMediaContainer(step.youtube);
    }

    if (step.stepType === "closedResponse" || step.stepType === "openResponse") {
        _renderResponseStep(step, lesson, deps);
    } else if (step.stepType === 'text') {
        handleTextStep(step, submitAnswerPrecheck);
        updateProgressAndCloseButton(true);
    } else if (step.stepType === 'lessoncomplete') {
        updateProgressAndCloseButton(true);
        handleLessonComplete(step, showFeedbackAndProceed);
        hideAnswerDiv();
    } else if (step.stepType === 'unitcomplete') {
        handleUnitComplete(step);
    } else if (step.stepType === 'lessonIntro') {
        _renderLessonIntro(step, lesson, deps);
    } else if (step.stepType === 'present') {
        _renderPresent(step, lesson, showFeedbackAndProceed);
    } else if (step.stepType === 'success') {
        _renderSuccess(step, fluencyData);
    }
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
        updateProgressAndCloseButton(true);
        const placeholder = Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...';
        const submitLabel = Strings.get('btn_submit', appStore.getState().userData?.native_language) || 'Submit';
        appStore.getState().setTextInputPlaceholder(placeholder);
        appStore.getState().setTextInputSubmitCallback((val, btn) => {
            submitAnswerPrecheck(val, step.cue, step, btn, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 });
        });
    } else {
        // Show close/progress button for speech response steps
        updateProgressAndCloseButton(true);
        const hintTempDiv = document.createElement('div');
        hintTempDiv.appendChild(answerFragment.cloneNode(true));
        appStore.getState().setSpeechInputContent(hintTempDiv.innerHTML);
        appStore.getState().setSpeechInputHintCallback(step.stepType === "closedResponse" ? null : () => handleHint(stepIndex));
        appStore.getState().setSpeechInputRevealCallback(handleRevealClick);
        appStore.getState().setSpeechInputToggleCallback(async () => {
            const speechButton = document.getElementById('micBtn');

            try {
                await toggleSpeechRecognition({
                    button: speechButton,
                    step,
                    micStatusText: document.getElementById('react-root-micstatus'),
                    userData: appStore.getState().userData,
                    configData: appStore.getState().configData,
                    currentLessonIndex: appStore.getState().currentLessonIndex,
                    currentStepIndex: stepIndex,
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
                            appStore.getState().setMicActive(false); // Release the lock
                            if (btn) {
                                btn.classList.add('toggled-off');
                                btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                                stopMicAnimation(btn);
                            }
                        },
                        onRecordingStart: (userData) => {
                            cancelWarningClear();
                            appStore.getState().setMicActive(true); // Lock the video timer
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
                                btn.style.display = "flex";
                                btn.disabled = false;
                                btn.classList.add('toggled-off');
                                btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                            }
                            appStore.getState().setMicStatusText(`<div class='text-center text-success mt-2'><i class="bi bi-check-circle"></i> Engine ready. Try speaking now!</div>`);
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
                            appStore.getState().setMicActive(false); // Release the lock
                            if (btn) {
                                btn.style.display = 'none';
                                stopMicAnimation(btn);
                            }
                            appStore.getState().setMicStatusText("");
                            appStore.getState().setMediaVisible(false);
                            appStore.getState().setTextInputVisible(false);
                            appStore.getState().setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`);
                        },
                        onStopEarly: (userData) => {
                            appStore.getState().setMicActive(false);
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMediaVisible(true);
                            appStore.getState().setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) btn.style.display = 'flex';
                            clearWarningLater(3000);
                        },
                        onGibberishDetected: () => {
                            appStore.getState().setMicActive(false);
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) btn.style.display = 'flex';
                            clearWarningLater(3000);
                        },
                        onPreflightRejected: (msg) => {
                            appStore.getState().setMicActive(false);
                            appStore.getState().triggerVideoClear();
                            appStore.getState().setWebcamStream(null);
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${msg}</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) {
                                btn.style.display = 'flex';
                                stopMicAnimation(btn);
                            }
                            clearWarningLater(4000);
                        },
                        onTranscriptRejected: (cue, transcript) => {
                            appStore.getState().setMicActive(false); // Release the lock
                            appStore.getState().triggerVideoClear();
                            appStore.getState().setWebcamStream(null);
                            window.dispatchEvent(new CustomEvent('transcriptRejected', { detail: { cue, transcript } }));
                            appStore.getState().setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) {
                                btn.style.display = 'flex';
                                stopMicAnimation(btn);
                            }
                        },
                        onReviewStart: (transcript, timeLeft, acceptFn, rejectFn) => {
                            appStore.getState().setMicActive(false); // Release the lock
                            renderWhisperReviewUI(transcript, timeLeft, acceptFn, rejectFn);
                        },
                        onReviewUpdate: (timeLeft) => {
                            updateWhisperTimer(timeLeft);
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
    updateProgressAndCloseButton(false); appStore.getState().setStatsVisible(false); hideAnswerDiv();

    let headsUpHTML = step.headsUp ? `<div class="chat-message-row chat-message-row--system"><div class="chat-message-bubble chat-message-bubble--system"><p class="headsUp mb-0">${step.headsUp}</p></div></div>` : "";

    if (!step.simpleVideoUrl) {
        let explanationHTML = "";
        if (step.explanation) {
            const lang = appStore.getState().userData?.native_language;
            const expTrans = getLocalizedTranslation(step.translation, lang);
            const localized = expTrans && lang && lang !== 'en' ? `<br><br><span lang='${lang}'><i>${expTrans}</i></span>` : '';
            explanationHTML = `<p class='explanation'>${step.explanation}${localized}</p>`;
        }

        addAIFeedbackMessages([
            `<p class='lesson-name'><strong>${Strings.get('lesson_label', appStore.getState().userData?.native_language)} ${getLocalizedTranslation(lesson.title)}</strong></p>`,
            explanationHTML
        ]);
    }
    showFeedbackAndProceed(step, true);
}

function _renderSuccess(step, fluencyData) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    bindProcessButton(() => State.player.destroy());

    step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId;

    window.__currentConfigData = appStore.getState().configData;

    handleSuccessStep(step, fluencyData);

    try { hideWebcamPreview(); } catch (error) { }
}

function _renderLessonIntro(step, lesson, deps) {
    const { showFeedbackAndProceed } = deps;
    appStore.getState().setStatsVisible(false);
    appStore.setState({ repeatPointsHistory: [] });
    appStore.setState({ rolePlayPointsHistory: [] });
    hideAnswerDiv();

    if (!step.simpleVideoUrl && step.explanation) {
        const lang = appStore.getState().userData?.native_language; const localizedTrans = getLocalizedTranslation(step.translation, lang); const hasTranslation = !!localizedTrans;
        const imagineStr = Strings.get('imagine', lang); const listenRepeatStr = Strings.get('listen_repeat', lang);

        const explanationStr = `
            <p class='explanation'>
              <strong>${imagineStr.split('<br>')[0]}</strong> ${step.explanation}
              <br><br>
              ➡${listenRepeatStr.split('<br>')[0]}
              ${hasTranslation && lang !== 'en' ? `<br><br><span lang='${lang}'><i><strong>🎯${imagineStr.includes('<br>') ? imagineStr.split('<i>')[1].split('<i>')[0] : imagineStr}</strong>${localizedTrans}<br><br>${listenRepeatStr.includes('<br>') ? listenRepeatStr.split('<i>')[1].split('<i>')[0] : listenRepeatStr}</i></span>` : ''}
            </p>`;

        addAIFeedbackMessages([
            `<p class='lesson-name'><strong>Lesson: ${lesson.title}</strong></p>`,
            explanationStr
        ]);
    }
    showFeedbackAndProceed(step, true);
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
