// --- modules/ui.js ---
import { State } from '../modules/state.js';
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import getRandomPraise from '../data/praise.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { Media } from '../modules/media.js';
import { pointLoss } from './point-loss-animation.js';
import { getPraiseHTML } from './feedback-renderer.web.js';

const AI_TUTOR_NAME = 'AI Tutor';
const AI_TUTOR_AVATAR = '/assets/img/ai.webp';

export const DOM = {
    get pronunciationScore() { return document.getElementById('pronunciationScore'); },
    get flowScore() { return document.getElementById('flowScore'); },
    get mediaViewport() { return document.getElementById('media-viewport'); },
    get bottomOverlay() { return document.querySelector('.bottom-overlay'); },
    get speechText() { return document.getElementById("chat-window-container"); },
    get chatBody() { return document.getElementById("chat-message-list"); },
    get avatarAi() { return document.getElementById("chat-avatar-system"); },
    get nameAi() { return document.getElementById("chat-name-system"); },
    get avatarHuman() { return document.getElementById("chat-avatar-user"); },
    get nameHuman() { return document.getElementById("chat-name-user"); },
    get statsContainer() { return document.getElementById("react-root-stats"); },
    get progressbar() { return document.getElementById('progress'); },
    get progressBarFill() { return document.getElementById("progress"); },
    get closeAndProgress() { return document.getElementById('closeAndProgress'); },
    get micStatusText() { return document.getElementById("react-root-micstatus"); },
    get whisperReviewContainer() { return document.getElementById('whisperReviewContainer'); },
    get whisperTranscript() { return document.getElementById('whisperTranscript'); },
    get criticalErrorContainer() { return document.getElementById('criticalErrorContainer'); },
    get criticalErrorMessage() { return document.getElementById('criticalErrorMessage'); },
    get dayCountSpan() { return document.getElementById("dayCountSpan"); },
    get streakCountSpan() { return document.getElementById("streakCountSpan"); },
    get playbackVideo() { return document.getElementById('playback-video'); },
    get playbackMuteToggle() { return document.getElementById('playback-mute-toggle'); },
    get tutorChatInputArea() { return document.getElementById('chat-input-area'); },
    get tutorChatTextarea() { return document.getElementById('chat-input-field'); },
    get tutorChatSendBtn() { return document.getElementById('chat-send-button'); },
    get micBtn() { return document.getElementById('micBtn'); },
    get txtBtn() { return document.getElementById('txtBtn'); },
    get answerInputArea() { return document.getElementById('answer-input-area'); },
    get answerInputField() { return document.getElementById('answer-input-field'); },
    get answerSubmitBtn() { return document.getElementById('answer-submit-button'); },
    get answerErrorMsg() { return document.getElementById('answer-error-message'); },
};

let webcamPreview = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function setChatHeader(isAI) {
    if (DOM.avatarAi) DOM.avatarAi.classList.toggle('d-none', !isAI);
    if (DOM.nameAi) DOM.nameAi.classList.toggle('d-none', !isAI);
    if (DOM.avatarHuman) DOM.avatarHuman.classList.toggle('d-none', isAI);
    if (DOM.nameHuman) DOM.nameHuman.classList.toggle('d-none', isAI);
}

export function getFirstName(displayName) {
    if (!displayName) return "User";
    return displayName.split(' ')[0];
}

export function flashElement(element) {
    if (!element) return;
    element.classList.remove('score-update');
    void element.offsetWidth;
    element.classList.add('score-update');
    setTimeout(() => element.classList.remove('score-update'), 300);
}
export function disableAllButtons(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
        // Skip React-owned mic/txt buttons — React controls their state
        if (!btn || btn.id === 'micBtn' || btn.id === 'txtBtn') return;
        btn.disabled = true;
        btn.classList.add('disabled');
    });
}

export function safeRenderChatInterface(isAI) {
    DOM.speechText.classList.remove('d-none');
    DOM.speechText.style.setProperty('display', 'flex', 'important');

    if (DOM.bottomOverlay) {
        DOM.bottomOverlay.style.setProperty('display', 'none', 'important');
    }

    document.body.classList.add('chat-mode-active');

    // We keep the header toggle for now until the header is also componentized
    if (typeof setChatHeader === 'function') {
        setChatHeader(isAI);
    }
}

export function renderAIAnalysisLoading(text) {
    if (DOM.whisperReviewContainer) DOM.whisperReviewContainer.classList.add("d-none");
    const storeState = appStore.getState();

    // Fallback translation handling
    let defaultText = 'Analyzing...';
    if (typeof Strings !== 'undefined' && typeof Strings.get === 'function') {
        defaultText = Strings.get('ai_analyzing', storeState.userData?.native_language) || defaultText;
    }

    safeRenderChatInterface(true);

    storeState.addChatMessage({
        role: 'system',
        type: 'aiLoading',
        content: text || defaultText
    });
}

export function renderAIFeedback(contentChunks = []) {
    safeRenderChatInterface(true);

    contentChunks.filter(Boolean).forEach(chunk => {
        // Check if this is a praise element (created by handleCorrectUI)
        const isPraise = chunk instanceof Element && chunk.classList.contains('chat-message-row--system') && chunk.querySelector('strong');

        if (isPraise) {
            const strongEl = chunk.querySelector('strong');
            const praiseText = strongEl ? strongEl.innerHTML : '';
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'praise',
                content: praiseText,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        } else {
            // CRITICAL: Serialize DOM nodes to strings for Zustand
            const htmlContent = typeof chunk === 'string' ? chunk : chunk.outerHTML;

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'htmlChunk',
                content: htmlContent
            });
        }
    });
}

export function showMicWarning(message) {
    const html = `<div class='text-center text-danger'>${message}</div>`;
    appStore.getState().setMicStatusText(html);
}
export function showAnswerError(message) {
    if (DOM.answerErrorMsg) {
        DOM.answerErrorMsg.innerHTML = message;
        DOM.answerErrorMsg.classList.remove('d-none');
        // Hide after 4 seconds
        setTimeout(() => {
            if (DOM.answerErrorMsg) DOM.answerErrorMsg.classList.add('d-none');
        }, 4000);
    }
}

export function resetMissionText(missionText, settingText, roleUserText, roleOtherText) {
    const missionEl = document.querySelector('.mission-text');
    if (missionEl) {
        missionEl.textContent = missionText || "";
    }
    const settingEl = document.querySelector('.setting-text');
    if (settingEl) {
        settingEl.textContent = settingText || "";
    }
    const roleUserEl = document.querySelector('.roleUser-text');
    if (roleUserEl) {
        roleUserEl.textContent = roleUserText || "";
    }
    const roleOtherEl = document.querySelector('.roleOther-text');
    if (roleOtherEl) {
        roleOtherEl.textContent = roleOtherText || "";
    }
}

export function resetMicStatusWithStep(questionText) {
    const html = `<div class='text-center'>${questionText || ""}</div>`;
    appStore.getState().setMicStatusText(html);
}

export function bindAuthMenuUI(isLoggedIn, handleAuthClick, signOutText, signInText) {
    const authLink = document.getElementById('auth-link');
    if (!authLink) return;
    authLink.textContent = isLoggedIn ? signOutText : signInText;
    authLink.removeEventListener('click', handleAuthClick);
    authLink.addEventListener('click', handleAuthClick);
}

/**
 * Initializes the mission section toggle logic.
 * Truncates text to one line by default and expands on click.
 */
export function initMissionToggle() {
    const missionSection = document.getElementById('mission-section');
    const carat = document.getElementById('mission-carat');

    if (missionSection) {
        missionSection.addEventListener('click', () => {
            const isExpanded = missionSection.classList.toggle('expanded');
            if (carat) {
                if (isExpanded) {
                    carat.classList.remove('bi-chevron-up');
                    carat.classList.add('bi-chevron-down');
                } else {
                    carat.classList.remove('bi-chevron-down');
                    carat.classList.add('bi-chevron-up');
                }
            }
            console.log(`[UI] Mission section ${isExpanded ? 'expanded' : 'collapsed'}`);
        });
    }
}

export function generateHangmanHint(userResponse, cue) {
    const tokenize = str => str.trim().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?|[^\p{L}\p{N}\s]+|\s+/gu) || [];
    const tokA = tokenize(userResponse || ""), tokB = tokenize(cue || "");
    const m = tokA.length, n = tokB.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase() ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const ops = []; let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase()) { ops.unshift({ type: 'eq', val: tokB[j - 1] }); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'ins', val: tokB[j - 1] }); j--; }
        else { ops.unshift({ type: 'del', val: tokA[i - 1] }); i--; }
    }

    let resultHTML = '';
    ops.forEach(({ type, val }) => {
        const v = val.replace(/</g, '&lt;');
        if (type === 'eq') {
            resultHTML += v;
        } else if (type === 'ins') {
            if (/\w/.test(v)) {
                resultHTML += ' <span class="hangman-placeholder">&nbsp;&nbsp;&nbsp;</span> ';
            } else {
                resultHTML += v;
            }
        } else if (type === 'del') {
            if (/\w/.test(v)) {
                resultHTML += `<span class="hangman-incorrect">${v}</span>`;
            }
        }
    });
    return resultHTML.replace(/\s+/g, ' ').trim();
}

export function clearChatInterface() {
    if (DOM.whisperReviewContainer) DOM.whisperReviewContainer.classList.add("d-none");
    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
        document.body.appendChild(videoWrapper); // Move it to safety before clearing
    }

    appStore.getState().clearChatHistory();

    DOM.speechText.classList.add('d-none');
    DOM.speechText.style.removeProperty('display');

    if (DOM.bottomOverlay) {
        DOM.bottomOverlay.style.removeProperty('display');
    }

    document.body.classList.remove('chat-mode-active');

    if (DOM.tutorChatInputArea) {
        DOM.tutorChatInputArea.classList.add('d-none');
        DOM.tutorChatInputArea.style.setProperty('display', 'none', 'important');
    }
    appStore.getState().setTutorChatVisible(false);
    if (DOM.answerInputArea) {
        DOM.answerInputArea.classList.add('d-none');
    }
    appStore.getState().setTextInputVisible(false);
    Object.values(SCORE_SPAN_MAP).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

const SCORE_SPAN_MAP = {
    pronunciation: 'chat-score-pronunciation',
    listening: 'chat-score-listening',
    flow: 'chat-score-flow',
    vocabulary: 'chat-score-vocabulary',
    grammar: 'chat-score-grammar',
    formality: 'chat-score-formality',
    nativeLike: 'chat-score-nativelike',
    understanding: 'chat-score-understanding',
    fluency: 'chat-score-fluency',
};

export function updateChatHeaderScores(feedbackData) {
    if (!feedbackData || !Array.isArray(feedbackData.sections)) return;
    feedbackData.sections.forEach(section => {
        const spanId = SCORE_SPAN_MAP[section.key];
        if (!spanId) return;
        const el = document.getElementById(spanId);
        if (!el) return;
        el.textContent = section.score === 100 ? '💯' : String(Math.round(section.score));
    });
}

export function getChatHistoryContext() {
    if (!DOM.chatBody) return "";

    const bubbles = Array.from(DOM.chatBody.querySelectorAll('.chat-message-bubble'));
    let historyText = "";
    for (const bubble of bubbles) {
        if (bubble.parentElement.id === 'ai-loading-status') continue;
        let role = bubble.classList.contains('chat-message-bubble--user') ? "Student" : "Tutor";
        historyText += `${role}: ${bubble.innerText}\n`;
    }
    return historyText;
}

export function renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject) {
    appStore.getState().removeAiLoadingMessage();
    appStore.getState().setMicStatusText("");
    if (!DOM.whisperReviewContainer || !DOM.whisperTranscript) return;

    // Populate content
    DOM.whisperTranscript.textContent = `"${transcript}"`;
    const timerSpan = document.getElementById("reviewTimer");
    if (timerSpan) timerSpan.innerText = timeLeft;

    // Show container
    DOM.whisperReviewContainer.classList.remove("d-none");

    // Setup progress bar
    const bar = document.getElementById("reviewProgressBar");
    if (bar) {
        bar.style.transition = "none";
        bar.style.width = "100%";
        requestAnimationFrame(() => {
            bar.style.transition = "width 7s linear";
            bar.style.width = "0%";
        });
    }

    // Attach events (cloning to clear previous)
    const acceptBtn = document.getElementById("acceptBtn");
    const rejectBtn = document.getElementById("rejectBtn");

    if (acceptBtn) {
        const newAccept = acceptBtn.cloneNode(true);
        acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
        newAccept.addEventListener("click", () => {
            DOM.whisperReviewContainer.classList.add("d-none");
            onAccept();
        });
    }

    if (rejectBtn) {
        const newReject = rejectBtn.cloneNode(true);
        rejectBtn.parentNode.replaceChild(newReject, rejectBtn);
        newReject.addEventListener("click", () => {
            DOM.whisperReviewContainer.classList.add("d-none");
            onReject();
        });
    }
}
export function updateWhisperTimer(timeLeft) {
    const timerSpan = document.getElementById('reviewTimer');
    if (timerSpan) timerSpan.innerText = timeLeft;
}


export function clearPlaybackVideo() {
    const video = document.getElementById('playback-video') || DOM.playbackVideo;
    if (video) {
        video.pause();
        if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
        video.src = '';
        video.load();
        video.style.display = 'none';
        video.onerror = null;
        video.onloadeddata = null;
        video.onloadedmetadata = null;
    }

    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
    }

    const muteToggle = document.getElementById('playback-mute-toggle') || DOM.playbackMuteToggle;
    if (muteToggle) muteToggle.classList.add('d-none');
}

export async function setupPlaybackVideo(blob, autoplay = false, speechCamChunks = []) {
    const playbackVideo = document.getElementById('playback-video') || DOM.playbackVideo;
    if (!playbackVideo) return;

    try {
        if (playbackVideo.src && playbackVideo.src.startsWith('blob:')) {
            URL.revokeObjectURL(playbackVideo.src);
        }

        if (isIOS) {
            await setupIOSBlobPlayback(playbackVideo, blob);
        } else {
            playbackVideo.src = URL.createObjectURL(blob);
        }

        const muteToggle = document.getElementById('playback-mute-toggle') || DOM.playbackMuteToggle;
        if (muteToggle) {
            muteToggle.classList.remove('d-none');
            const icon = muteToggle.querySelector('i');
            if (icon) {
                icon.className = State.isPlaybackMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
            }
            muteToggle.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                State.isPlaybackMuted = !State.isPlaybackMuted;
                playbackVideo.muted = State.isPlaybackMuted;
                if (icon) {
                    icon.className = State.isPlaybackMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
                }
            };
        }

        playbackVideo.onerror = (e) => {
            try {
                const fallbackBlob = new Blob(speechCamChunks, { type: 'video/mp4' });
                playbackVideo.src = URL.createObjectURL(fallbackBlob);
            } catch (fallbackError) { }
        };

        playbackVideo.controls = false;
        playbackVideo.loop = true;
        playbackVideo.autoplay = false;
        playbackVideo.preload = 'auto';
        playbackVideo.muted = State.isPlaybackMuted || false;
        playbackVideo.style.cursor = 'pointer';

        if (playbackVideo._interactionHandler) {
            playbackVideo.removeEventListener('touchstart', playbackVideo._interactionHandler);
            playbackVideo.removeEventListener('click', playbackVideo._interactionHandler);
        }

        playbackVideo._interactionHandler = function (e) {
            e.preventDefault(); e.stopPropagation();
            requestAnimationFrame(() => {
                if (this.paused) {
                    this.play().catch(e => {
                        this.currentTime = 0;
                        setTimeout(() => this.play().catch(console.error), 100);
                    });
                } else {
                    this.pause();
                }
            });
        };

        playbackVideo.addEventListener('touchstart', playbackVideo._interactionHandler, { passive: false });
        playbackVideo.addEventListener('click', playbackVideo._interactionHandler);

        if (window._playbackObserver) {
            window._playbackObserver.disconnect();
        }
        window._playbackObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting && !playbackVideo.paused) {
                    playbackVideo.pause();
                }
            });
        }, { threshold: 0.1 });

        playbackVideo.onloadedmetadata = () => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (wrapper) {
                const videoFrame = document.querySelector('.video-frame');
                if (videoFrame && wrapper.parentElement !== videoFrame) {
                    videoFrame.appendChild(wrapper);
                }
                wrapper.classList.remove('d-none');
                wrapper.style.display = 'flex';

                // Clear any inline styles set by VideoBubble chat bubble conversion
                wrapper.style.width = '';
                wrapper.style.height = '';
                playbackVideo.style.width = '';
                playbackVideo.style.height = '';
                playbackVideo.style.maxHeight = '';
                playbackVideo.style.borderRadius = '';
                playbackVideo.style.objectFit = '';

                // Set absolute positioning so it floats correctly inside video-frame
                wrapper.style.position = 'absolute';
                wrapper.style.top = '15%';
                wrapper.style.left = '0';
                wrapper.style.right = '0';
                wrapper.style.zIndex = '5';
            }

            playbackVideo.style.display = 'block';
            if (autoplay) {
                playbackVideo.play().catch(e => {
                    console.warn('[Playback] autoplay failed:', e);
                    if (e.name === 'NotAllowedError') {
                        // Fallback to muted playback if browser blocks unmuted
                        playbackVideo.muted = true;
                        State.isPlaybackMuted = true;
                        const muteToggle = document.getElementById('playback-mute-toggle') || DOM.playbackMuteToggle;
                        if (muteToggle) {
                            const icon = muteToggle.querySelector('i');
                            if (icon) icon.className = 'bi bi-volume-mute-fill';
                        }
                        playbackVideo.play().catch(err => console.error('[Playback] muted fallback failed:', err));
                    }
                });
            }

            // Observe visibility AFTER making it visible, using requestAnimationFrame
            requestAnimationFrame(() => {
                if (window._playbackObserver) {
                    window._playbackObserver.observe(playbackVideo);
                }
            });
        };

    } catch (urlError) { }
}

async function setupIOSBlobPlayback(videoElement, blob) {
    return new Promise((resolve) => {
        videoElement.controls = true; videoElement.loop = true;
        const url = URL.createObjectURL(blob);
        videoElement.onerror = () => {
            try {
                const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
                videoElement.src = URL.createObjectURL(alternativeBlob);
                resolve();
            } catch (fallbackError) {
                resolve();
            }
        };
        videoElement.src = url;
        videoElement.onloadeddata = () => resolve();
        setTimeout(() => resolve(), 2000);
    });
}


export function resetUIForNewStep(isLessonIntro, hasUserData) {
    // Reset bottom controls to mic state
    appStore.getState().setBottomControlState('mic');

    // 1. Clear out our dynamic compilation elements
    const resultVideo = document.getElementById('resultVideo');
    if (resultVideo) resultVideo.remove();
    const displayCanvas = document.getElementById('displayCanvas');
    if (displayCanvas) displayCanvas.remove();

    // 2. Clear out the dynamic success action buttons
    const continueSuccess = document.getElementById('continueButtonSuccess');
    if (continueSuccess) continueSuccess.remove();

    const repeatSuccess = document.getElementById('repeatButtonSuccess');
    if (repeatSuccess) repeatSuccess.remove();

    // 3. Reset the core process/create video button back to its initial UI state
    const videoBtn = document.getElementById('processBtn') || document.getElementById('createVideoButton');
    if (videoBtn) {
        videoBtn.disabled = false;
        videoBtn.classList.remove('btn-success', 'flex-fill');
        videoBtn.classList.add('btn-outline-primary', 'w-100');
        videoBtn.innerHTML = '<i class="bi bi-film text-white"></i>';
    }

    // --- Rest of your original resetUIForNewStep code begins here ---
    const lessonIntroHeader = document.getElementById('lessonIntroHeader');
    if (lessonIntroHeader) lessonIntroHeader.classList.toggle('d-none', !isLessonIntro || hasUserData);

    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.toggle('d-none', isLessonIntro && !hasUserData);

    const myToastClose = document.querySelector('#myToast .btn-close');
    if (myToastClose) myToastClose.click();

    const successMedia = document.getElementById("success-media");
    if (successMedia) successMedia.classList.add("d-none");

    const courseProgress = document.getElementById("courseProgress");
    if (courseProgress) courseProgress.classList.add("d-none");

    // Clear any inline styles or disabled states that speech callbacks may have left
    // on the React-owned mic/txt buttons from the previous step.
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

export function removeRepeatButton() {
    let repeatButton = document.getElementById('repeatButton');
    if (repeatButton) repeatButton.remove();
}

export function clearMediaContainerAndPreservePlayers() {
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
                // React wrappers (InteractiveVideoWrapper, SimpleVideoWrapper)
                // manage these containers via portal — preserve content across steps.
            } else {
                el.innerHTML = '';
            }
        }

        DOM.mediaViewport.appendChild(el);
    });
}

export function renderImageInMediaContainer(imageUrl) {
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

export function renderYoutubeInMediaContainer(youtubeId) {
    if (!DOM.mediaViewport) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<iframe width="315" height="560" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8" title="Intro" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    DOM.mediaViewport.prepend(div);
}



export function updateProgressAndCloseButton(showClose) {
    if (DOM.closeAndProgress) {
        if (showClose) DOM.closeAndProgress.classList.remove('d-none');
        else DOM.closeAndProgress.classList.add('d-none');
    }
}

export function hideAnswerDiv() {
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
}

export function bindProcessButton(onClickCallback) {
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.addEventListener('click', onClickCallback);
}

export function showMessageInStepsContainer(messageHTML) {
    const container = document.getElementById('steps-container');
    if (container) {
        container.innerHTML = `<div class="text-center">${messageHTML}</div>`;
    }
}

export function setupLessonUI(fullTitle) {
    const ivpWrapper = document.querySelector('.ivp-main-wrapper');
    if (ivpWrapper) ivpWrapper.classList.remove('d-none');

    const footer = document.querySelector('footer');
    if (footer) footer.classList.remove("d-none");

    document.body.classList.remove('bg-dark');
    if (DOM.mediaViewport) DOM.mediaViewport.classList.remove('d-none');

    const lessonHeader = document.getElementById('lesson-header');
    if (lessonHeader) {
        lessonHeader.style.display = 'block';
        lessonHeader.classList.remove('lesson-header');
        void lessonHeader.offsetWidth;
        lessonHeader.classList.add('lesson-header');
    }

    const titles = document.getElementsByClassName('lesson-title');
    for (let i = 0; i < titles.length; i++) {
        if (titles[i]) {
            titles[i].textContent = fullTitle;
        }
    }
}

export function handlecueUI(stepIndex, stepData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction, userData, configData, fluencyBubble = null) {

    if (stepData.stepType === "closedResponse" && stepData.videoUrl) appStore.setState({ repeatPointsHistory: [...appStore.getState().repeatPointsHistory, appStore.getState().listeningScore] });
    if (stepData.stepType === "openResponse" && stepData.videoUrl) appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });

    if (DOM.speechText) {
        const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
        const praiseResult = (stepData.stepType === "openResponse" || stepData.stepType === "closedResponse") ? getRandomPraise('general', lang) : "";
        const feedbackText = (stepData.stepType === "openResponse" && englishLevelDeduction > 0)
            ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
            : getPraiseHTML(praiseResult);

        if (stepData.stepType !== "openResponse" && stepData.stepType !== "closedResponse") {
            const localizedTrans = getLocalizedTranslation(translation, lang);

            const userName = getFirstName(appStore.getState().userData?.display_name);
            const userAvatarUrl = appStore.getState().userData?.profilepicurl || '/assets/img/userprofile.webp';

            const correctWrapper = document.createElement('div');
            correctWrapper.className = 'chat-message-row chat-message-row--user correct-answer-wrapper';

            const correctImg = document.createElement('img');
            correctImg.src = userAvatarUrl;
            correctImg.alt = userName;
            correctImg.className = 'chat-avatar-inline';

            const correctBubble = document.createElement('div');
            correctBubble.classList.add('correct-answer-display', 'chat-message-bubble', 'chat-message-bubble--user');

            const correctHeader = document.createElement('div');
            correctHeader.className = 'chat-bubble-header d-none';
            correctHeader.textContent = userName;
            correctBubble.appendChild(correctHeader);

            const correctTextSpan = document.createElement('span');
            correctTextSpan.textContent = cue;
            correctBubble.appendChild(correctTextSpan);

            if (localizedTrans && lang && lang !== 'en') {
                correctBubble.appendChild(document.createElement('br'));
                const transSpan = document.createElement('span');
                transSpan.lang = lang;
                const transI = document.createElement('i');
                transI.textContent = localizedTrans;
                transSpan.appendChild(transI);
                correctBubble.appendChild(transSpan);
            }

            const praiseWrapper = document.createElement('div');
            praiseWrapper.className = 'chat-message-row chat-message-row--system';
            praiseWrapper.style.marginTop = '6px';

            const praiseImg = document.createElement('img');
            praiseImg.src = '/assets/img/teacherprofile.webp';
            praiseImg.alt = 'Joe Walsh';
            praiseImg.className = 'chat-avatar-inline';

            const praiseBubble = document.createElement('div');
            praiseBubble.classList.add('chat-message-bubble', 'chat-message-bubble--system');

            const praiseHeader = document.createElement('div');
            praiseHeader.className = 'chat-bubble-header';
            praiseHeader.textContent = 'Joe Walsh';
            praiseBubble.appendChild(praiseHeader);

            const praiseStrong = document.createElement('strong');
            praiseStrong.innerHTML = getPraiseHTML(getRandomPraise('general', lang));
            praiseBubble.appendChild(praiseStrong);

            praiseWrapper.appendChild(praiseImg);
            praiseWrapper.appendChild(praiseBubble);

            correctWrapper.appendChild(correctImg);
            correctWrapper.appendChild(correctBubble);

            const chunks = [correctWrapper];
            if (Array.isArray(explanation)) chunks.push(...explanation);
            else if (explanation) chunks.push(explanation);
            if (fluencyBubble) chunks.push(fluencyBubble);
            chunks.push(praiseWrapper, stepData.headsUp);

            renderAIFeedback(chunks);
        } else {
            const chunks = [];
            if (Array.isArray(explanation)) chunks.push(...explanation);
            else if (explanation) chunks.push(explanation);
            if (fluencyBubble) chunks.push(fluencyBubble);
            chunks.push(feedbackText ? `<strong>${feedbackText}</strong>` : "", stepData.headsUp);

            renderAIFeedback(chunks);
        }
    }

    Media.playSound('correct-sound');
}

export function handleIncueUI(stepIndex, stepData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, step, silent = false, userData, configData, fluencyBubble = null) {
    appStore.getState().incrementIncorrectAttempts();

    if (!silent && !State.isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        const storeState = appStore.getState();
        const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
        if (!hasVideoBubble) {
            storeState.addChatMessage({
                role: 'user',
                type: 'video',
                userName: getFirstName(storeState.userData?.display_name),
                userAvatarUrl: storeState.userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
        } else {
            const video = document.getElementById('playback-video');
            if (video) {
                video.muted = storeState.isPlaybackMuted;
                video.play().catch(e => console.warn('[handleIncueUI] Playback resume failed:', e));
            }
        }
    }

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) {
        appStore.getState().deductListeningScore(25);
        pointLoss.show(DOM.micStatusText, 25);
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
        }
    }

    // In silent mode for speech steps, we're called from the silent retry flow in app.js
    // which handles its own hangman hint rendering. Skip chat bubbles entirely for this case.
    const isSilentSpeechRetry = silent && stepData.stepType === "closedResponse";

    if (isSilentSpeechRetry) {
        // Silent retry for speech: just increment attempts, no UI rendering needed
        // The calling code in app.js handles hangman hint separately
        return;
    }

    if (stepData.stepType === "openResponse" && userResponse) {
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
        }

const teacherTextStr = appStore.getState().incorrectAttempts === 1
                ? Strings.get('try_again_1', userData?.native_language)
                : appStore.getState().incorrectAttempts === 2
                    ? Strings.get('try_again_2', userData?.native_language)
                    : (() => {
                        const lang = userData?.native_language;
                        const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
                        const transStr = (localizedTrans && lang && lang !== 'en')
                            ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>`
                            : "";
                        return `${Strings.get('failed_continue_correct', userData?.native_language)}<br>"${cue}"${transStr}`;
                    })();

        const teacherDiv = document.createElement('div');
        const teacherStrong = document.createElement('strong');
        teacherStrong.innerHTML = teacherTextStr;
        teacherDiv.appendChild(teacherStrong);

        let headsUpNode = '';
        if (stepData.headsUp) {
            const headsUpText = appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_try_again', userData?.native_language) : stepData.headsUp;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = headsUpText;
            headsUpNode = tempDiv;
        }

        let possibleAnswerNode = '';
        if (stepData.possibleAnswer && appStore.getState().incorrectAttempts > 2) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = `${Strings.get('example_correct_answer', appStore.getState().userData?.native_language)}<br>${stepData.possibleAnswer}`;
            possibleAnswerNode = tempDiv;
        }

        const chunks = [];
        if (Array.isArray(explanation)) chunks.push(...explanation);
        else if (explanation) chunks.push(explanation);

        chunks.push(teacherDiv);
        if (fluencyBubble) chunks.push(fluencyBubble);
        if (possibleAnswerNode) chunks.push(possibleAnswerNode);
        if (headsUpNode) chunks.push(headsUpNode);

        renderAIFeedback(chunks);
    }

    if (stepData.stepType === "closedResponse" && userResponse && DOM.speechText) {
        const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))];
        const correctWords = [...new Set(normalizedcue.split(/\s+/))];
        const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
        const correct = new Set(); const incorrect = new Set();

        selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

        const correctUl = correct.size > 0 ? `<ul class='card-text correctWords list-inline' id='correctWords' style='display:block'>${Array.from(correct).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>` : '';
        const incorrectUl = incorrect.size > 0 ? `<ul class='card-text incorrectWords list-inline' id='incorrectWords' style='display:block; border-top: 1px solid rgba(255,255,255,0.1)'>${Array.from(incorrect).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>` : '';

        const teacherText = appStore.getState().incorrectAttempts === 1
            ? Strings.get('try_again_1', appStore.getState().userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', appStore.getState().userData?.native_language)
                : (() => {
                    const lang = appStore.getState().userData?.native_language;
                    const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
                    const transStr = (localizedTrans && lang && lang !== 'en')
                        ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>`
                        : "";
                    return `${Strings.get('failed_continue', appStore.getState().userData?.native_language)}<br><br>Correct:<br>"${cue}"${transStr}`;
                })();

        const headsUpStr = stepData.headsUp
            ? (appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_repeat_video', appStore.getState().userData?.native_language) : stepData.headsUp)
            : '';

        const chunks = [`<strong>${teacherText}</strong><br><br>${correctUl}${incorrectUl}`];
        if (Array.isArray(explanation)) chunks.push(...explanation);
        else if (explanation) chunks.push(explanation);
        if (fluencyBubble) chunks.push(fluencyBubble);
        chunks.push(headsUpStr);

        renderAIFeedback(chunks);
    }

    // Only play sound if not in silent mode (silent means minimal audio feedback)
    if (!silent) {
        Media.playSound('incorrect-sound');
    }

}