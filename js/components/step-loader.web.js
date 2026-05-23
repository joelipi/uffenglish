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
import { saveLessonProgress } from '../modules/user-profile.js';
import { getCompressedLessonStats } from '../modules/scoring.js';
import { pointLoss } from '../components/point-loss-animation.js';
import {
    DOM
} from './ui.js';
import {
    clearChatInterface,
    renderAIFeedback
} from './chat/chat-interface.js';
import { clearPlaybackVideo } from './playback.js';

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

    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.toggle('d-none', isLessonIntro && !hasUserData);

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
    if (!DOM.mediaViewport) return;

    const preserved = DOM.mediaViewport.querySelectorAll('#ivp-container, #simple-video-container, #intro-call-widget, #webcam-preview');
    DOM.mediaViewport.innerHTML = '';

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

        DOM.mediaViewport.appendChild(el);
    });
}

function renderImageInMediaContainer(imageUrl) {
    if (!DOM.mediaViewport) return;

    DOM.mediaViewport.classList.remove('d-none');
    DOM.mediaViewport.style.display = 'block';

    const existingPraise = DOM.mediaViewport.querySelectorAll('.praise-image-wrapper');
    existingPraise.forEach(el => el.remove());

    const div = document.createElement('div');
    div.className = 'text-center mb-3 praise-image-wrapper';
    div.innerHTML = `<img src="${imageUrl}" class="img-fluid rounded" alt="Praise" style="max-height: 250px; border: 3px solid #00f2fe; box-shadow: 0 0 15px rgba(0,242,254,0.5);">`;

    DOM.mediaViewport.prepend(div);
}

function renderYoutubeInMediaContainer(youtubeId) {
    if (!DOM.mediaViewport) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<iframe width="315" height="560" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8" title="Intro" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    DOM.mediaViewport.prepend(div);
}

function updateProgressAndCloseButton(showClose) {
    if (DOM.closeAndProgress) {
        if (showClose) DOM.closeAndProgress.classList.remove('d-none');
        else DOM.closeAndProgress.classList.add('d-none');
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

let _warningClearTimer = null;

function _clearWarningLater(ms) {
    clearTimeout(_warningClearTimer);
    _warningClearTimer = setTimeout(() => {
        appStore.getState().setMicStatusText('');
        _warningClearTimer = null;
    }, ms);
}

function _cancelWarningClear() {
    clearTimeout(_warningClearTimer);
    _warningClearTimer = null;
}

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
    clearChatInterface();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    resetUIForNewStep(step.stepType === 'lessonIntro', !!appStore.getState().userData);

    Media.cleanupPreviousPlayers();
    State.player = null;
    appStore.getState().setCurrentVideo(null);
    clearPlaybackVideo();

    appStore.getState().setStatsVisible((step.stepType === 'closedResponse' || step.stepType === 'openResponse') && step.videoUrl);

    if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
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

    appStore.getState().setMediaVisible(true);

    clearMediaContainerAndPreservePlayers();

    if (step.image) {
        renderImageInMediaContainer(step.image);
    }
    if (step.youtube) {
        renderYoutubeInMediaContainer(step.youtube);
    }

    loadVideoForStep(step, State, appStore.getState().userData?.native_language);

    appStore.getState().setMicStatusText(step.step);

    if (step.stepType === "closedResponse" || step.stepType === "openResponse") {
        _renderResponseStep(step, lesson, deps);
    } else if (step.stepType === 'text') {
        appStore.getState().setStatsVisible(true);
        updateProgressAndCloseButton(true);
        appStore.getState().setTextInputPlaceholder(
            Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...'
        );
        appStore.getState().setTextInputSubmitCallback(
            (val, btn) => submitAnswerPrecheck(val, typeof step.cue === 'object' ? step.cue.en : step.cue, step, btn, step.explanation, step.translation, { pauseCount: null, netDuration: null })
        );
    } else if (step.stepType === 'lessoncomplete') {
        updateProgressAndCloseButton(true); appStore.getState().setStatsVisible(false);
        appStore.getState().setProgressPercent("95%"); showFeedbackAndProceed(step, true);
        hideAnswerDiv();
    } else if (step.stepType === 'unitcomplete') {
        step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId + 's';
        State.successHandler.handleSuccessLesson(step);
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

    if (State.isTextMode) {
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
                    micStatusText: DOM.micStatusText,
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
                            window.isMicActive = false; // Release the lock
                            if (btn) {
                                btn.classList.add('toggled-off');
                                btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                                stopMicAnimation(btn);
                            }
                        },
                        onRecordingStart: (userData) => {
                            _cancelWarningClear();
                            window.isMicActive = true; // Lock the video timer
                            if (window.currentVideoPlayer) {
                                if (typeof window.currentVideoPlayer.pause === 'function') {
                                    window.currentVideoPlayer.pause();
                                } else if (window.currentVideoPlayer.video) {
                                    window.currentVideoPlayer.video.pause();
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
                            window.isMicActive = false; // Release the lock
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
                            window.isMicActive = false;
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMediaVisible(true);
                            appStore.getState().setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) btn.style.display = 'flex';
                            _clearWarningLater(3000);
                        },
                        onGibberishDetected: () => {
                            window.isMicActive = false;
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) btn.style.display = 'flex';
                            _clearWarningLater(3000);
                        },
                        onPreflightRejected: (msg) => {
                            window.isMicActive = false;
                            clearPlaybackVideo();
                            appStore.getState().setWebcamStream(null);
                            window.dispatchEvent(new CustomEvent('preflightRejected'));
                            appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${msg}</div>`);
                            const btn = document.getElementById('micBtn');
                            if (btn) {
                                btn.style.display = 'flex';
                                stopMicAnimation(btn);
                            }
                            _clearWarningLater(4000);
                        },
                        onTranscriptRejected: (cue, transcript) => {
                            window.isMicActive = false; // Release the lock
                            clearPlaybackVideo();
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
                            window.isMicActive = false; // Release the lock
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

        renderAIFeedback([
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

    // initVideoProcessor was removed during index.html migration
    State.successHandler.handleSuccessLesson(step);

    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        const finalStats = getCompressedLessonStats({
            isTextMode: State.isTextMode,
            isCameraOff: State.isCameraOff,
            lessonStartTime: State.lessonStartTime,
            averageWpm: State.averageWpm,
            totalPauses: State.totalPauses,
            totalHesitations: State.totalHesitations,
            recognizedIdioms: State.recognizedIdioms,
            pragmaticFlags: State.pragmaticFlags,
            interactionLog: State.interactionLog
        });

        saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData, {
            updateUserMeta: true,
            incrementCount: true,
            lessonStats: finalStats,
            currentLessonId: step.lessonId
        }).then(progressResult => {
            appStore.getState().setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
            if (progressResult.lessonsCompleted) {
                appStore.getState().setLessonsCompleted(progressResult.lessonsCompleted);
            }
        });
    };

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

        renderAIFeedback([
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
