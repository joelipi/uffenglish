// --- modules/ui.js ---
import { State } from './state.js';

// 1. Centralize DOM Elements
export const DOM = {
    phrasesScore: document.getElementById('phrasesScore'),
    mediaContainer: document.getElementById('media-container'),
    speechText: document.getElementById("speech-text-here"),
    chatBody: document.getElementById("chat-messenger-body"),
    avatarAi: document.getElementById("chat-avatar-ai"),
    nameAi: document.getElementById("chat-name-ai"),
    avatarHuman: document.getElementById("chat-avatar-human"),
    nameHuman: document.getElementById("chat-name-human"),
    heart3: document.getElementById("heart3"),
    heart2: document.getElementById("heart2"),
    heart1: document.getElementById("heart1"),
    scoresAndHearts: document.getElementById("scoresAndHearts"),
    progressbar: document.getElementById('progress'),
    progressBarFill: document.getElementById("progress-bar"),
    closeAndProgress: document.getElementById('closeAndProgress'),
    micStatusText: document.getElementById("micStatusText"),
    dayCountSpan: document.getElementById("dayCountSpan"),
    // NEW: Added the streak span from app.php
    streakCountSpan: document.getElementById("streakCountSpan"),
    arrowContainer: document.getElementById("arrow-container"),
    playbackVideoMobile: document.getElementById('playback-video-mobile'),
    playbackVideoDesktop: document.getElementById('playback-video-desktop'),
    playbackMuteToggleMobile: document.getElementById('playback-mute-toggle-mobile'),
    playbackMuteToggleDesktop: document.getElementById('playback-mute-toggle-desktop'),
    questionsContainerContainer: document.getElementById('questions-container-container'),
    questionsContainer: document.getElementById('questions-container')
};

let webcamPreview = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 2. Helper to switch between AI and Human headers
function setChatHeader(isAI) {
    DOM.avatarAi.classList.toggle('d-none', !isAI);
    DOM.nameAi.classList.toggle('d-none', !isAI);
    DOM.avatarHuman.classList.toggle('d-none', isAI);
    DOM.nameHuman.classList.toggle('d-none', isAI);
}

// 2. UI Helper Functions
export function flashElement(element) {
    if (!element) return;
    element.classList.remove('score-update');
    // Force a reflow to restart the animation
    void element.offsetWidth;
    element.classList.add('score-update');
    setTimeout(() => element.classList.remove('score-update'), 300);
}

export function updateCurrentScoreDisplay(currentPoints) {
    const element = document.getElementById('currentScore');
    if (element) {
        flashElement(element);
        element.textContent = currentPoints;
    }
}

/**
 * Updates the streak and day count displays simultaneously
 * @param {number} totalDays - Total count from completed_dates.length
 * @param {number} currentStreak - Result from calculateCurrentStreak()
 */
export function updateActivityDisplay(totalDays, currentStreak) {
    if (DOM.dayCountSpan) {
        DOM.dayCountSpan.textContent = totalDays;
        // Optional: flash only if value changes
        flashElement(DOM.dayCountSpan);
    }

    if (DOM.streakCountSpan) {
        DOM.streakCountSpan.textContent = currentStreak;
        // Visual feedback for the streak is highly encouraging for users
        flashElement(DOM.streakCountSpan);
    }
}

// Keep the old function for backward compatibility with other parts of your app
export function updateDayCountDisplay(dayCount) {
    if (DOM.dayCountSpan) {
        flashElement(DOM.dayCountSpan);
        DOM.dayCountSpan.textContent = dayCount;
    }
}

export function disableAllButtons(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('disabled');
        }
    });
}

// 3. The new Data-Driven render function
export function safeRenderChatInterface(isAI, bodyContent) {
    DOM.speechText.classList.remove('d-none'); // Unhide the whole widget
    setChatHeader(isAI); // Swap the avatar/name

    // Remove the loading spinner if it exists
    const loadingStatus = DOM.chatBody.querySelector('#ai-loading-status');
    if (loadingStatus) {
        loadingStatus.remove();
    }

    // Append the new bubbles
    if (bodyContent) {
        if (typeof bodyContent === 'string') {
            DOM.chatBody.insertAdjacentHTML('beforeend', bodyContent);
        } else if (bodyContent instanceof Node) {
            DOM.chatBody.appendChild(bodyContent);
        }
    }

    // Auto-scroll to bottom
    setTimeout(() => {
        DOM.chatBody.scrollTop = DOM.chatBody.scrollHeight;
    }, 10);
}

/**
 * 🎨 UI BUILDER: Renders the user's spoken or typed response
 */
export function renderUserResponse(text, statsHtml = "") {
    const html = `
        <div class='userResponse chat-bubble-sent chat-msg'>${text}</div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}

/**
 * 🎨 UI BUILDER: Renders a loading indicator while AI is thinking
 */
export function renderAIAnalysisLoading(text = "Analyzing your response...") {
    const html = `
        <div class='chat-bubble chat-msg' id='ai-loading-status'>
            <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${text}</strong>
        </div>`;
    safeRenderChatInterface(true, html);
}

/**
 * 🎨 UI BUILDER: Renders a standardized stats bubble
 */

export function createHeaderHTML(text) {
    if (!text) return "";
    return `<div style='font-size: 0.85em; text-transform: uppercase; color: #17a2b8; margin-bottom: 5px;'><strong>${text}</strong></div>`;
}

export function createPragmaticsBubbleHTML(headingHTML, contentHTML) {
    return `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
        ${headingHTML ? headingHTML : ''}
        ${contentHTML}
    </div>`;
}

export function createStatsBubbleHTML(header, statsParts) {
    const listHtml = statsParts && statsParts.length > 0 ? `<ul>${statsParts.map(part => `<li>${part}</li>`).join('')}</ul>` : '';
    return `
        <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
            ${createHeaderHTML(header)}
            ${listHtml}
        </div>`;
}

/**
 * 🎨 UI BUILDER: Renders a grammar correction bubble with a diff
 */
export function createGrammarDiffHTML(original, correction, headingText = "") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
            ${createHeaderHTML(headingText)}
            <div class="diff-del-bubble">${userHTML}</div>
            <div style="margin-top:6px">${corrHTML}</div>
        </div>`;
}

/**
 * 🎨 UI BUILDER: Renders a general AI feedback bubble (explanation, heads-up, etc.)
 */
export function renderAIFeedback(contentChunks = []) {
    // Filter out empty strings and wrap each chunk in a bubble if not already wrapped
    const fragment = document.createDocumentFragment();
    contentChunks
        .filter(Boolean)
        .forEach(chunk => {
            if (typeof chunk === 'string') {
                if (chunk.includes("chat-bubble")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chunk;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                } else {
                    const bubble = document.createElement('div');
                    bubble.className = 'chat-bubble chat-msg';
                    bubble.style.marginTop = '12px';
                    bubble.style.display = 'block';
                    bubble.innerHTML = chunk;
                    fragment.appendChild(bubble);
                }
            } else if (chunk instanceof Node) {
                // If it's already a node, ensure it has chat-bubble styling if appropriate, or just append it
                if (chunk.nodeType === Node.ELEMENT_NODE && !chunk.classList.contains('chat-msg')) {
                    // It's just a raw element, maybe we wrap it or trust the caller to have styled it.
                    // The caller might be providing a fully constructed bubble.
                    // If it doesn't have chat-bubble, we'll wrap it to maintain style.
                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-bubble chat-msg';
                    wrapper.style.marginTop = '12px';
                    wrapper.style.display = 'block';
                    wrapper.appendChild(chunk);
                    fragment.appendChild(wrapper);
                } else {
                    fragment.appendChild(chunk);
                }
            }
        });

    safeRenderChatInterface(true, fragment);
}

/**
 * 🎨 UI BUILDER: Internal helper to generate diff HTML
 */
function buildGrammarDiff(original, corrected) {
    const tokenize = str => str.trim().match(/[\w']+|[^\w\s']+|\s+/g) || [];
    const tokA = tokenize(original), tokB = tokenize(corrected);
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

    let userHTML = '', corrHTML = '';
    ops.forEach(({ type, val }) => {
        const v = val.replace(/</g, '&lt;');
        if (type === 'eq') { userHTML += v; corrHTML += v; }
        if (type === 'del') { userHTML += `<span class="diff-del">${v}</span>`; }
        if (type === 'ins') { corrHTML += `<span class="diff-ins">${v}</span>`; }
    });
    return { userHTML, corrHTML };
}

/**
 * 🎨 UI BUILDER: Generates a 'hangman' version of the cue based on user response
 */
export function generateHangmanHint(userResponse, cue) {
    const tokenize = str => str.trim().match(/[\w']+|[^\w\s']+|\s+/g) || [];
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
            // Missed word from cue -> underscore placeholder
            if (/\w/.test(v)) {
                resultHTML += ' <span class="hangman-placeholder">&nbsp;&nbsp;&nbsp;</span> ';
            } else {
                resultHTML += v;
            }
        } else if (type === 'del') {
            // Incorrect word from user -> red text
            if (/\w/.test(v)) {
                resultHTML += `<span class="hangman-incorrect">${v}</span>`;
            }
        }
    });

    // Clean up double spaces
    return resultHTML.replace(/\s+/g, ' ').trim();
}

// 4. NEW: A clean way to wipe the chat between questions
export function clearChatInterface() {
    DOM.chatBody.innerHTML = '';
    DOM.speechText.classList.add('d-none'); // Hide widget entirely
}

// 5. Encapsulated DOM Logic
export function showHintsAndScroll() {
    const hints = document.getElementById("hints");
    if (hints) {
        hints.classList.remove("d-none", "invisible");
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
}

export function hideHints() {
    const hints = document.getElementById("hints");
    if (hints) hints.classList.add("d-none");
    const hintButton = document.getElementById('hintButton');
    if (hintButton) hintButton.classList.add('invisible');
}

export function clearMicStatusAndHideMedia() {
    if (DOM.micStatusText) DOM.micStatusText.innerHTML = "";
    if (DOM.mediaContainer) DOM.mediaContainer.classList.add('d-none');
}

export function setMicStatusText(content) {
    if (DOM.micStatusText) {
        DOM.micStatusText.innerHTML = '';
        if (typeof content === 'string') {
            DOM.micStatusText.innerHTML = content;
        } else if (content instanceof Node) {
            DOM.micStatusText.appendChild(content);
        }
    }
}

export function renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject) {
    if (!DOM.micStatusText) return;

    DOM.micStatusText.innerHTML = `
        <div class='text-center mt-3 p-3 bg-dark rounded border border-secondary shadow-sm'>
            <div style='font-size: 1.1rem; color: #fff; margin-bottom: 15px;'>
                <small class="text-muted d-block mb-1">Whisper heard:</small>
                <strong>"${transcript}"</strong>
            </div>
            <div class="d-flex justify-content-center gap-3">
                <button id="rejectBtn" class="btn btn-outline-danger px-4">
                    <i class="bi bi-arrow-repeat"></i> Re-record
                </button>
                <button id="acceptBtn" class="btn btn-success px-4">
                    <i class="bi bi-check-circle"></i> Accept (<span id="reviewTimer">${timeLeft}</span>s)
                </button>
            </div>
            <div class="progress mt-3" style="height: 5px; background-color: #333;">
                <div id="reviewProgressBar" class="progress-bar bg-success" role="progressbar" style="width: 100%; transition: width 7s linear;"></div>
            </div>
        </div>`;

    // Bind listeners
    setTimeout(() => {
        document.getElementById('acceptBtn')?.addEventListener('click', onAccept);
        document.getElementById('rejectBtn')?.addEventListener('click', onReject);

        // Trigger animation
        const bar = document.getElementById('reviewProgressBar');
        if (bar) {
            requestAnimationFrame(() => {
                bar.style.width = '0%';
            });
        }
    }, 50);
}

export function updateWhisperTimer(timeLeft) {
    const timerSpan = document.getElementById('reviewTimer');
    if (timerSpan) timerSpan.innerText = timeLeft;
}

export function pauseVideoIfPlaying(playerInstance) {
    // 1. Instance approach: keeps player UI/internal state in sync
    if (playerInstance) {
        if (typeof playerInstance.pause === 'function') {
            playerInstance.pause();
        } else if (playerInstance.video && !playerInstance.video.paused) {
            playerInstance.video.pause();
        }
    }

    // 2. DOM Fallback: Catch ALL .ivp-video elements
    const videoElements = document.querySelectorAll('video.ivp-video');
    videoElements.forEach(video => {
        if (!video.paused) {
            video.pause();
        }
    });
}

export function updateSpeakingScoreDisplay(score) {
    if (DOM.phrasesScore) DOM.phrasesScore.textContent = `${score}`;
}

export function clearPlaybackVideo() {
    [DOM.playbackVideoMobile, DOM.playbackVideoDesktop].forEach(video => {
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
    });

    if (DOM.playbackMuteToggleMobile) DOM.playbackMuteToggleMobile.classList.add('d-none');
    if (DOM.playbackMuteToggleDesktop) DOM.playbackMuteToggleDesktop.classList.add('d-none');
}

export function prepareMediaUI() {
    if (DOM.mediaContainer) DOM.mediaContainer.classList.remove('d-none');
}

export function showPlaybackVideo() {
    const playbackVideo = window.innerWidth >= 1200 ? DOM.playbackVideoDesktop : DOM.playbackVideoMobile;
    if (playbackVideo) playbackVideo.style.display = 'block';
}

export function isWebcamPreviewVisible() {
    return webcamPreview && webcamPreview.isConnected && !webcamPreview.classList.contains('d-none');
}

export function createWebcamPreview() {
    if (webcamPreview) webcamPreview.remove();

    webcamPreview = document.createElement('video');
    webcamPreview.id = 'webcam-preview';
    webcamPreview.autoplay = true;
    webcamPreview.muted = true;
    webcamPreview.playsinline = true;

    // Set opacity:0 BEFORE insertion
    webcamPreview.style.opacity = '0';

    const isDesktop = window.innerWidth >= 1200;

    if (isDesktop) {
        if (DOM.questionsContainerContainer) DOM.questionsContainerContainer.appendChild(webcamPreview);
    } else {
        if (DOM.mediaContainer) {
            DOM.mediaContainer.appendChild(webcamPreview);
        } else {
            webcamPreview.style.position = 'fixed';
            webcamPreview.style.bottom = '10px';
            webcamPreview.style.right = '10px';
            document.body.appendChild(webcamPreview);
        }
    }
    return webcamPreview;
}

export function ensureWebcamPreview(stream) {
    if (!stream) return null;
    if (!webcamPreview || !document.getElementById('webcam-preview')) {
        webcamPreview = createWebcamPreview();
    }

    if (webcamPreview.srcObject !== stream) {
        webcamPreview.srcObject = stream;
    }

    if (webcamPreview.classList.contains('d-none')) {
        webcamPreview.style.transition = '';
        webcamPreview.style.opacity = '0';
        webcamPreview.style.transform = 'scaleX(-1) translateY(10px)';
        webcamPreview.classList.remove('d-none');

        setTimeout(() => {
            webcamPreview.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
            webcamPreview.style.opacity = '1';
            webcamPreview.style.transform = 'scaleX(-1) translateY(0)';
        }, 500);
    }

    setTimeout(() => {
        if (isWebcamPreviewVisible() && (webcamPreview.readyState < 2 || webcamPreview.paused)) {
            webcamPreview.play().catch(e => console.log('Play failed:', e));
        }
    }, 100);

    return webcamPreview;
}

export function toggleCamera() {
    State.isCameraOff = !State.isCameraOff;
    console.log(`[UI] Camera toggled. isCameraOff: ${State.isCameraOff}`);
    // The placeholder/webcam switch will be handled by speech.js re-warming the stream
}


export function hideWebcamPreview() {
    if (webcamPreview && webcamPreview.isConnected) webcamPreview.classList.add('d-none');
}

export function removeWebcamPreview() {
    if (webcamPreview) {
        webcamPreview.pause();
        webcamPreview.srcObject = null;
        webcamPreview.classList.add('d-none');
        // Do NOT remove from DOM and do NOT set to null
    }
}

export async function setupPlaybackVideo(blob, autoplay = false, speechCamChunks = []) {
    const isDesktop = window.innerWidth > 1000;
    const playbackVideo = isDesktop ? DOM.playbackVideoDesktop : DOM.playbackVideoMobile;

    if (!playbackVideo) {
        console.error('[Playback] playbackVideo element not found');
        return;
    }

    try {
        if (playbackVideo.src && playbackVideo.src.startsWith('blob:')) {
            URL.revokeObjectURL(playbackVideo.src);
        }

        if (isIOS) {
            await setupIOSBlobPlayback(playbackVideo, blob);
        } else {
            playbackVideo.src = URL.createObjectURL(blob);
        }

        const muteToggle = isDesktop ? DOM.playbackMuteToggleDesktop : DOM.playbackMuteToggleMobile;

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
            console.error('[Playback] playbackVideo error:', e);
            try {
                const fallbackBlob = new Blob(speechCamChunks, { type: 'video/mp4' });
                playbackVideo.src = URL.createObjectURL(fallbackBlob);
            } catch (fallbackError) {
                console.error('[Playback] Fallback failed:', fallbackError);
            }
        };

        playbackVideo.controls = true;
        playbackVideo.loop = true;
        playbackVideo.autoplay = false;
        playbackVideo.preload = 'auto';
        playbackVideo.muted = State.isPlaybackMuted || false;

        if (!isIOS) {
            const handleVideoInteraction = function (e) {
                e.preventDefault(); e.stopPropagation();
                requestAnimationFrame(() => {
                    if (this.paused && this.readyState >= 2) {
                        this.play().catch(e => { this.currentTime = 0; setTimeout(() => this.play().catch(console.error), 100); });
                    } else if (!this.paused) this.pause();
                });
            };
            playbackVideo.addEventListener('touchstart', handleVideoInteraction, { passive: false });
            playbackVideo.addEventListener('click', handleVideoInteraction);
            playbackVideo.style.cursor = 'pointer';
        }

        playbackVideo.onloadedmetadata = () => {
            playbackVideo.style.display = 'block';
            if (autoplay) {
                playbackVideo.play().catch(e => console.warn('[Playback] autoplay failed:', e));
            }
        };

    } catch (urlError) {
        console.error('[Playback] setupPlaybackVideo threw:', urlError);
    }
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


export function markButtonAsCorrect(button) {
    if (!button) return;
    button.classList.add('btn-success', 'correct-answer');
    button.addEventListener('animationend', () => button.classList.remove('correct-answer'), { once: true });
}

export function markButtonAsIncorrect(button, answersContainer, cue) {
    if (!button) return;
    button.classList.remove('btn-outline-primary');
    button.classList.add('btn-secondary', 'disabled', 'incorrect-answer');

    if (answersContainer && cue) {
        const cueButton = Array.from(answersContainer.querySelectorAll('button')).find(btn => btn.textContent.trim().toLowerCase() === cue.trim().toLowerCase());
        if (cueButton) cueButton.classList.add('correct-answer-highlight');
    }

    button.addEventListener('animationend', () => button.classList.remove('incorrect-answer'), { once: true });
}

export function animateHeartLoss(incorrectAttempts) {
    if (incorrectAttempts == 1 && DOM.heart1) DOM.heart1.classList.add("falling-image");
    else if (incorrectAttempts == 2 && DOM.heart2) DOM.heart2.classList.add("falling-image");
    else if (incorrectAttempts == 3 && DOM.heart3) DOM.heart3.classList.add("falling-image");
}

export function resetHeartsUI() {
    const hearts = [DOM.heart1, DOM.heart2, DOM.heart3];
    hearts.forEach(heart => {
        if (heart) {
            heart.classList.remove("falling-image");
            heart.classList.remove("d-none");
        }
    });
}

export function showContinueButton(isLessonIntro, onClickCallback, onAudioOnlyClickCallback) {
    let continueButton = document.getElementById('continueButton');
    let audioOnlyButton = document.getElementById('audioOnlyButton');
    let btnGroup = document.getElementById('introButtonGroup');
    const centerBar = document.getElementById('bottomButtonBarCenter');

    if (isLessonIntro) {
        if (!btnGroup && centerBar) {
            btnGroup = document.createElement('div');
            btnGroup.className = 'd-flex gap-2 w-100';
            btnGroup.id = 'introButtonGroup';
            centerBar.appendChild(btnGroup);

            // Move existing continueButton into the group if it exists
            if (continueButton && continueButton.parentNode === centerBar) {
                btnGroup.appendChild(continueButton);
            }
        }
    }

    if (!continueButton) {
        continueButton = document.createElement('button');
        continueButton.id = 'continueButton';
        continueButton.className = 'btn btn-primary text-white w-100';
        if (isLessonIntro && btnGroup) {
            btnGroup.appendChild(continueButton);
        } else if (centerBar) {
            centerBar.appendChild(continueButton);
        }
    } else if (isLessonIntro && btnGroup && continueButton.parentNode !== btnGroup) {
        // Ensure it is in the group
        btnGroup.appendChild(continueButton);
    } else if (!isLessonIntro && centerBar && continueButton.parentNode === btnGroup) {
        // Move it back out of the group
        centerBar.appendChild(continueButton);
        // And hide the group
        btnGroup.style.display = 'none';
    }

    if (!audioOnlyButton && isLessonIntro && btnGroup) {
        audioOnlyButton = document.createElement('button');
        audioOnlyButton.id = 'audioOnlyButton';
        audioOnlyButton.className = 'btn btn-primary text-white w-100';
        audioOnlyButton.innerHTML = '<i class="bi bi-telephone-fill text-white" style="font-size: 40px; font-weight: 900;"></i>';
        btnGroup.appendChild(audioOnlyButton);
    }

    if (audioOnlyButton) {
        audioOnlyButton.style.display = isLessonIntro ? 'inline-block' : 'none';
        if (isLessonIntro) {
            audioOnlyButton.onclick = () => {
                if (!State.isCameraOff) {
                    toggleCamera();
                }
                if (onAudioOnlyClickCallback) {
                    onAudioOnlyClickCallback();
                } else {
                    onClickCallback();
                }
            };
        }
    }

    if (btnGroup) {
        btnGroup.style.display = isLessonIntro ? 'flex' : 'none';
    }

    if (continueButton) {
        continueButton.innerHTML = isLessonIntro ? '<i class="bi bi-camera-video-fill text-white" style="font-size: 40px; font-weight: 900;"></i>' : '<i class="bi bi-chevron-right text-white" style="font-size: 40px; font-weight: 900;"></i>';
        continueButton.onclick = () => {
            if (isLessonIntro && State.isCameraOff) {
                toggleCamera();
            }
            onClickCallback();
        };
        continueButton.style.display = 'inline-block';

        // Adjust button widths if both are showing
        if (isLessonIntro && audioOnlyButton) {
            continueButton.classList.replace('w-100', 'w-50');
            audioOnlyButton.classList.replace('w-100', 'w-50');
        } else {
            continueButton.classList.replace('w-50', 'w-100');
        }
    }

    return continueButton;
}

export function hideContinueButton() {
    const continueButton = document.getElementById('continueButton');
    if (continueButton) continueButton.style.display = 'none';
    const audioOnlyButton = document.getElementById('audioOnlyButton');
    if (audioOnlyButton) audioOnlyButton.style.display = 'none';
}

export function renderFallbackContinueButton(text, onClickCallback) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = onClickCallback;
    document.body.appendChild(btn);
}

export function resetUIForNewQuestion(isLessonIntro, hasUserData) {
    const resultVideo = document.getElementById('resultVideo');
    if (resultVideo) resultVideo.remove();
    const displayCanvas = document.getElementById('displayCanvas');
    if (displayCanvas) displayCanvas.remove();

    if (DOM.arrowContainer) DOM.arrowContainer.classList.toggle('d-none', !isLessonIntro);

    const lessonIntroHeader = document.getElementById('lessonIntroHeader');
    if (lessonIntroHeader) lessonIntroHeader.classList.toggle('d-none', !isLessonIntro || hasUserData);

    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.toggle('d-none', isLessonIntro && !hasUserData);

    const myToastClose = document.querySelector('#myToast .btn-close');
    if (myToastClose) myToastClose.click();

    const successMedia = document.getElementById("success-media");
    if (successMedia) successMedia.classList.add("d-none");

    const courseProgress = document.getElementById("courseProgress");
    if (courseProgress) courseProgress.classList.add("d-none");
}

export function toggleScoresAndHearts(show) {
    if (DOM.scoresAndHearts) {
        if (show) DOM.scoresAndHearts.classList.remove('d-none');
        else DOM.scoresAndHearts.classList.add('d-none');
    }
}

export function removeRepeatButton() {
    let repeatButton = document.getElementById('repeatButton');
    if (repeatButton) repeatButton.remove();
}

export function clearMediaContainerAndPreservePlayers() {
    if (!DOM.mediaContainer) return;

    // 1. Identify containers we want to keep
    const preserved = DOM.mediaContainer.querySelectorAll('#ivp-container, #simple-ivp-container, #intro-call-widget, #webcam-preview');

    // 2. Wipe the parent container
    DOM.mediaContainer.innerHTML = '';

    // 3. Re-append preserved shells and RESET any leftover inline style overrides or hidden classes.
    // This allows the CSS :empty pseudo-class in style.css to manage visibility
    // dynamically (hiding them when empty, showing them when they have children).
    preserved.forEach(el => {
        el.style.display = '';
        el.style.minHeight = '';

        // Neutral state: Shells are available (unhidden), but the Call Widget is hidden by default
        if (el.id === 'intro-call-widget') {
            el.classList.add('d-none');
        } else if (el.id === 'webcam-preview') {
            // Keep the webcam's current visibility state as managed by speech.js
            // and do NOT clear its innerHTML (video element)
        } else {
            el.classList.remove('d-none');
            // Always clear innerHTML of video shells during reset. This ensures they 
            // are truly empty so CSS :empty can collapse them (0px height).
            el.innerHTML = '';
        }

        DOM.mediaContainer.appendChild(el);
    });
}

export function renderImageInMediaContainer(imageUrl) {
    console.log(`[UI] renderImageInMediaContainer called for: ${imageUrl}`);
    if (!DOM.mediaContainer) {
        console.error('[UI] mediaContainer DOM element not found!');
        return;
    }
    
    // Ensure visibility
    DOM.mediaContainer.classList.remove('d-none');
    DOM.mediaContainer.style.display = 'block'; 

    // Remove any previous praise images to avoid stacking
    const existingPraise = DOM.mediaContainer.querySelectorAll('.praise-image-wrapper');
    existingPraise.forEach(el => el.remove());

    const div = document.createElement('div');
    div.className = 'text-center mb-3 praise-image-wrapper';
    div.innerHTML = `<img src="${imageUrl}" class="img-fluid rounded" alt="Praise" style="max-height: 250px; border: 3px solid #00f2fe; box-shadow: 0 0 15px rgba(0,242,254,0.5);">`;
    
    console.log('[UI] Prepending image to mediaContainer');
    DOM.mediaContainer.prepend(div);
}

export function renderYoutubeInMediaContainer(youtubeId) {
    if (!DOM.mediaContainer) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<iframe width="315" height="560" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8" title="Intro" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    DOM.mediaContainer.prepend(div);
}

export function resetAnswersContainer(html) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = html;
    }
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
    const answersContainer = document.getElementById("answers-container");
    if (answersContainer) answersContainer.classList.remove("d-none");
}

export function renderSpeechInputUI(answerContent, handleHintCallback, handleRevealClickCallback, toggleSpeechCallback) {
    const hintUncommonWords = document.getElementById("hintUncommonWords");
    if (hintUncommonWords) {
        hintUncommonWords.innerHTML = '';
        if (typeof answerContent === 'string') {
            hintUncommonWords.innerHTML = answerContent;
        } else if (answerContent instanceof Node) {
            hintUncommonWords.appendChild(answerContent);
        }
        document.querySelectorAll('.pulse-dot').forEach(span => {
            // Need a wrapper to handle the callback and clean up event listener, but handleRevealClickCallback inside script.js does it already
            span.addEventListener('click', handleRevealClickCallback);
        });
    }

    const bottomButtonBarLeft = document.getElementById("bottomButtonBarLeft");
    if (bottomButtonBarLeft) {
        if (handleHintCallback) {
            const hintButton = document.createElement('button');
            hintButton.className = 'btn bg-transparent text-white border-0';
            hintButton.id = 'hintButton';
            hintButton.innerHTML = '<i class="bi bi-life-preserver fs-1"></i>';
            hintButton.onclick = () => {
                handleHintCallback();
                hintButton.style.visibility = 'hidden';
            };
            bottomButtonBarLeft.innerHTML = '';
            bottomButtonBarLeft.appendChild(hintButton);
        } else {
            bottomButtonBarLeft.innerHTML = '';
        }
    }

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const speechInput = document.createElement('div');
        speechInput.className = 'speech-input';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';
        buttonContainer.id = 'buttonContainer';

        const speechButton = document.createElement('button');
        speechButton.className = 'btn btn-primary';
        speechButton.id = 'speechButton';
        speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>';
        speechButton.onclick = toggleSpeechCallback;

        const bottomButtonBarCenter = document.getElementById("bottomButtonBarCenter");
        if (bottomButtonBarCenter) {
            bottomButtonBarCenter.innerHTML = '';
            bottomButtonBarCenter.appendChild(buttonContainer);
            buttonContainer.appendChild(speechButton);
        }

        const speechText = document.createElement('p');
        speechInput.appendChild(speechText);
        answersContainer.appendChild(speechInput);
    }
}

export function renderTextInputUI(placeholder, submitText, handleSubmitCallback) {
    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.remove('d-none');
    if (DOM.scoresAndHearts) DOM.scoresAndHearts.classList.remove('d-none');
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.className = 'form-control mb-3';
        inputField.placeholder = placeholder;

        const submitButton = document.createElement('button');
        submitButton.className = 'btn btn-primary';
        submitButton.textContent = submitText;
        submitButton.onclick = () => handleSubmitCallback(inputField.value.trim(), submitButton);

        answersContainer.appendChild(inputField);
        answersContainer.appendChild(submitButton);
    }
}

export function updateProgressAndCloseButton(showClose) {
    if (DOM.closeAndProgress) {
        if (showClose) DOM.closeAndProgress.classList.remove('d-none');
        else DOM.closeAndProgress.classList.add('d-none');
    }
}

export function setProgressBarWidth(percentage) {
    if (DOM.progressBarFill) DOM.progressBarFill.style.width = percentage;
}

export function hideAnswerDiv() {
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
}

export function bindProcessButton(onClickCallback) {
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.addEventListener('click', onClickCallback);
}

export function renderMultiChoiceUI(notSureText, handleNotSureCallback, answers, handleAnswerCallback) {
    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.remove('d-none');
    if (DOM.scoresAndHearts) DOM.scoresAndHearts.classList.remove('d-none');

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const notSureButton = document.createElement('button');
        notSureButton.className = 'btn btn-outline-secondary';
        notSureButton.textContent = notSureText;
        notSureButton.onclick = () => handleNotSureCallback("I'm not sure", notSureButton);
        answersContainer.appendChild(notSureButton);

        answers.forEach((answer) => {
            const button = document.createElement('button');
            button.className = 'btn btn-outline-primary';
            button.textContent = answer;
            button.onclick = () => handleAnswerCallback(answer, button);
            answersContainer.appendChild(button);
        });
    }
}

export function showMessageInQuestionsContainer(messageHTML) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = `<div class="text-center">${messageHTML}</div>`;
    }
}

export function showErrorMessageInQuestionsContainer(messageHTML) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = `<div class="alert alert-danger">${messageHTML}</div>`;
    }
}

export function setupLessonUI(fullTitle) {
    const ivpWrapper = document.querySelector('.ivp-main-wrapper');
    if (ivpWrapper) ivpWrapper.classList.remove('d-none');

    const footer = document.querySelector('footer');
    if (footer) footer.classList.remove("d-none");

    const bottomBar = document.getElementById('bottomButtonBar');
    if (bottomBar) bottomBar.classList.remove('d-none');

    const bottomBarSuccess = document.getElementById('bottomButtonBarSuccess');
    if (bottomBarSuccess) bottomBarSuccess.classList.add('d-none');

    document.body.classList.remove('bg-dark');
    if (DOM.mediaContainer) DOM.mediaContainer.classList.remove('d-none');

    const lessonHeader = document.getElementById('lesson-header');
    if (lessonHeader) {
        lessonHeader.style.display = 'block';
        lessonHeader.classList.remove('lesson-header');
        void lessonHeader.offsetWidth; // Trigger reflow for animation
        lessonHeader.classList.add('lesson-header');
    }

    const titles = document.getElementsByClassName('lesson-title');
    for (let i = 0; i < titles.length; i++) {
        if (titles[i]) {
            titles[i].textContent = fullTitle;
        }
    }
}