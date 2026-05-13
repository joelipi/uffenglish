// --- modules/ui.js ---
import { State } from '../modules/state.js';
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import getRandomPraise from '../data/praise.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { Media } from '../modules/media.js';
import { pointLoss } from './point-loss-animation.js';

// Inject dynamic styles to override padding, set avatar size, and control responsive width
const dynamicStyles = document.createElement('style');
dynamicStyles.textContent = `
    .chat-avatar-inline {
        width: 40px !important;
        height: 40px !important;
        flex-shrink: 0 !important;
        object-fit: cover !important;
        border-radius: 50% !important;
    }
    .chat-msg {
        padding: 4px 12px !important;
        width: 100%;
        max-width: 95%; /* Mobile width */
    }
    @media (min-width: 768px) {
        .chat-msg {
            max-width: 80%; /* Desktop width */
        }
    }
    .chat-bubble-header {
        font-size: 0.75rem;
        color: #888;
        margin-bottom: 2px;
        font-weight: bold;
    }
    .userResponse .chat-bubble-header {
        text-align: right;
    }
`;
document.head.appendChild(dynamicStyles);

export function syncTextModeUI() {
    const phrasesScore = document.getElementById('phrasesScore');
    if (phrasesScore) {
        if (State.isTextMode) {
            phrasesScore.classList.add('d-none');
            console.log('[UI] Text mode: hiding speaking score');
        } else {
            phrasesScore.classList.remove('d-none');
            console.log('[UI] Camera/Mic mode: showing speaking score');
        }
    }
}

export const DOM = {
    get phrasesScore() { return document.getElementById('phrasesScore'); },
    get mediaContainer() { return document.getElementById('media-container'); },
    get speechText() { return document.getElementById("speech-text-here"); },
    get chatBody() { return document.getElementById("chat-messenger-body"); },
    get avatarAi() { return document.getElementById("chat-avatar-ai"); },
    get nameAi() { return document.getElementById("chat-name-ai"); },
    get avatarHuman() { return document.getElementById("chat-avatar-human"); },
    get nameHuman() { return document.getElementById("chat-name-human"); },
    get heart3() { return document.getElementById("heart3"); },
    get heart2() { return document.getElementById("heart2"); },
    get heart1() { return document.getElementById("heart1"); },
    get scoresAndHearts() { return document.getElementById("scoresAndHearts"); },
    get progressbar() { return document.getElementById('progress'); },
    get progressBarFill() { return document.getElementById("progress-bar"); },
    get closeAndProgress() { return document.getElementById('closeAndProgress'); },
    get micStatusText() { return document.getElementById("micStatusText"); },
    get dayCountSpan() { return document.getElementById("dayCountSpan"); },
    get streakCountSpan() { return document.getElementById("streakCountSpan"); },
    get arrowContainer() { return document.getElementById("arrow-container"); },
    get playbackVideo() { return document.getElementById('playback-video'); },
    get playbackMuteToggle() { return document.getElementById('playback-mute-toggle'); },
    get questionsContainerContainer() { return document.getElementById('questions-container-container'); },
    get questionsContainer() { return document.getElementById('questions-container'); },
    get tutorChatInputArea() { return document.getElementById('tutor-chat-input-area'); },
    get tutorChatTextarea() { return document.getElementById('tutor-chat-textarea'); },
    get tutorChatSendBtn() { return document.getElementById('tutor-chat-send-btn'); }
};

let webcamPreview = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

function setChatHeader(isAI) {
    DOM.avatarAi.classList.toggle('d-none', !isAI);
    DOM.nameAi.classList.toggle('d-none', !isAI);
    DOM.avatarHuman.classList.toggle('d-none', isAI);
    DOM.nameHuman.classList.toggle('d-none', isAI);
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

export function updateCurrentScoreDisplay(listeningScore) {
    const points = listeningScore !== undefined ? listeningScore : appStore.getState().listeningScore;
    const element = document.getElementById('currentScore');
    if (element) {
        flashElement(element);
        element.textContent = points;
    }
}

export function updateActivityDisplay(totalDays, currentStreak) {
    if (DOM.dayCountSpan) {
        DOM.dayCountSpan.textContent = totalDays;
        flashElement(DOM.dayCountSpan);
    }
    if (DOM.streakCountSpan) {
        DOM.streakCountSpan.textContent = currentStreak;
        flashElement(DOM.streakCountSpan);
    }
}

export function updateDayCountDisplay(dayCount) {
    const safeDayCount = dayCount !== undefined ? dayCount : appStore.getState().dayCount;
    if (DOM.dayCountSpan) {
        flashElement(DOM.dayCountSpan);
        DOM.dayCountSpan.textContent = safeDayCount;
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

export function safeRenderChatInterface(isAI, bodyContent) {
    DOM.speechText.classList.remove('d-none');
    setChatHeader(isAI);

    const loadingStatus = DOM.chatBody.querySelector('#ai-loading-status');
    if (loadingStatus) {
        loadingStatus.remove();
    }

    if (bodyContent) {
        if (typeof bodyContent === 'string') {
            DOM.chatBody.insertAdjacentHTML('beforeend', bodyContent);
        } else if (bodyContent instanceof Node) {
            DOM.chatBody.appendChild(bodyContent);
        }
    }

    // Auto-scroll ONLY the chat container
    setTimeout(() => {
        const lastMessage = DOM.chatBody.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 50);
}

export function renderUserResponse(text, statsHtml = "") {
    const safeText = escapeHTML(text);
    const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
    const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.png';
    const html = `
        <div class='chat-message-wrapper user-message-wrapper'>
            <img src='${userAvatarUrl}' alt='${userName}' class='chat-avatar-inline' />
            <div class='userResponse chat-bubble-sent chat-msg'>
                <div class='chat-bubble-header'>${userName}</div>
                ${safeText}
            </div>
        </div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}

export function renderAIAnalysisLoading(text) {
    const defaultText = Strings.get('ai_analyzing', State.userData?.native_language);
    const displayText = text || defaultText;
    const aiAvatarUrl = 'assets/img/teacherprofile.jpeg';
    const html = `
        <div class='chat-message-wrapper ai-message-wrapper' id='ai-loading-status'>
            <img src='${aiAvatarUrl}' alt='Joe Walsh' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg'>
                <div class='chat-bubble-header'>Joe Walsh</div>
                <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${displayText}</strong>
            </div>
        </div>`;
    safeRenderChatInterface(true, html);
}

export function createHeaderHTML(text) {
    return "";
}

export function createPragmaticsBubbleHTML(headingHTML, contentHTML, correctionHTML = "", botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.jpeg") {
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-top: 0px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block;'>
                <div class='chat-bubble-header'>${botName}</div>
                ${contentHTML}${correctionHTML ? ` ${correctionHTML}` : ''}
            </div>
        </div>`;
}

export function createStatsBubbleHTML(header, statsParts, botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.jpeg") {
    const partsHtml = statsParts && statsParts.length > 0
        ? ` ${statsParts.join('. ')}`
        : '';
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-bottom: 0px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block; border-left: 4px solid #17a2b8;'>
                <div class='chat-bubble-header'>${botName}</div>
                <span>${header}${partsHtml}</span>
            </div>
        </div>`;
}

export function createGrammarDiffHTML(original, correction, headingText = "", botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.jpeg") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-top: 0px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block;'>
                <div class='chat-bubble-header'>${botName}</div>
                <div class="diff-del-bubble">${userHTML}</div>
                <div style="margin-top:6px">${corrHTML}</div>
            </div>
        </div>`;
}

export function getPraiseHTML(praiseData) {
    if (!praiseData) return "";
    if (typeof praiseData === 'string') return praiseData;
    if (praiseData.type === 'image') {
        return `<img src="${praiseData.content}" class="img-fluid rounded" alt="Praise" style="max-height: 200px; display: block; margin: 0 auto;">`;
    }
    return praiseData.text || "";
}

export function renderAIFeedback(contentChunks = []) {
    const fragment = document.createDocumentFragment();
    contentChunks
        .filter(Boolean)
        .forEach(chunk => {
            if (typeof chunk === 'string') {
                if (chunk.includes("chat-message-wrapper") || chunk.includes("chat-bubble")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chunk;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                } else {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-message-wrapper ai-message-wrapper';
                    wrapper.style.marginTop = '4px';

                    const img = document.createElement('img');
                    img.src = 'assets/img/teacherprofile.jpeg';
                    img.alt = 'Joe Walsh';
                    img.className = 'chat-avatar-inline';

                    const bubble = document.createElement('div');
                    bubble.className = 'chat-bubble chat-msg';
                    bubble.style.display = 'block';
                    bubble.innerHTML = `<div class='chat-bubble-header'>Joe Walsh</div>${chunk}`;

                    wrapper.appendChild(img);
                    wrapper.appendChild(bubble);
                    fragment.appendChild(wrapper);
                }
            } else if (chunk instanceof Node) {
                if (chunk.nodeType === Node.ELEMENT_NODE && !chunk.classList.contains('chat-msg') && !chunk.classList.contains('chat-message-wrapper')) {
                    const outerWrapper = document.createElement('div');
                    outerWrapper.className = 'chat-message-wrapper ai-message-wrapper';
                    outerWrapper.style.marginTop = '4px';

                    const img = document.createElement('img');
                    img.src = 'assets/img/teacherprofile.jpeg';
                    img.alt = 'Joe Walsh';
                    img.className = 'chat-avatar-inline';

                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-bubble chat-msg';
                    wrapper.style.display = 'block';

                    const header = document.createElement('div');
                    header.className = 'chat-bubble-header';
                    header.textContent = 'Joe Walsh';

                    wrapper.appendChild(header);
                    wrapper.appendChild(chunk);
                    outerWrapper.appendChild(img);
                    outerWrapper.appendChild(wrapper);
                    fragment.appendChild(outerWrapper);
                } else {
                    fragment.appendChild(chunk);
                }
            }
        });

    safeRenderChatInterface(true, fragment);
}

function buildGrammarDiff(original, corrected) {
    const tokenize = str => str.trim().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?|[^\p{L}\p{N}\s]+|\s+/gu) || [];
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
    const isPunct = tok => /^[^\p{L}\p{N}]+$/u.test(tok);
    ops.forEach(({ type, val }) => {
        const v = val.replace(/</g, '&lt;');
        if (type === 'eq') { userHTML += v; corrHTML += v; }
        else if (type === 'del') {
            if (isPunct(val)) { userHTML += v; }
            else { userHTML += `<span class="diff-del">${v}</span>`; }
        }
        else if (type === 'ins') {
            if (isPunct(val)) { corrHTML += v; }
            else { corrHTML += `<span class="diff-ins">${v}</span>`; }
        }
    });
    return { userHTML, corrHTML };
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
    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
        document.body.appendChild(videoWrapper);
    }

    DOM.chatBody.innerHTML = '';
    DOM.speechText.classList.add('d-none');
    hideTutorChatInput();
}

export function initTutorChatUI(submitCallback) {
    if (!DOM.tutorChatTextarea || !DOM.tutorChatSendBtn) return;

    DOM.tutorChatSendBtn.addEventListener('click', () => {
        const text = DOM.tutorChatTextarea.value;
        if (text && text.trim().length > 0) {
            DOM.tutorChatTextarea.value = '';
            submitCallback(text);
        }
    });

    DOM.tutorChatTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { }
    });
}

export function showTutorChatInput() {
    if (DOM.tutorChatInputArea) DOM.tutorChatInputArea.classList.remove('d-none');
}

export function hideTutorChatInput() {
    if (DOM.tutorChatInputArea) DOM.tutorChatInputArea.classList.add('d-none');
}

export function getChatHistoryContext() {
    if (!DOM.chatBody) return "";

    const bubbles = Array.from(DOM.chatBody.querySelectorAll('.chat-msg'));
    let historyText = "";
    for (const bubble of bubbles) {
        if (bubble.id === 'ai-loading-status') continue;
        let role = bubble.classList.contains('userResponse') ? "Student" : "Tutor";
        historyText += `${role}: ${bubble.innerText}\n`;
    }
    return historyText;
}

export function renderTutorMessage(text, isUser) {
    if (isUser) {
        renderUserResponse(text);
    } else {
        const safeText = escapeHTML(text);
        const aiAvatarUrl = 'assets/img/teacherprofile.jpeg';
        const html = `
            <div class='chat-message-wrapper ai-message-wrapper'>
                <img src='${aiAvatarUrl}' alt='Joe Walsh' class='chat-avatar-inline' />
                <div class='chat-bubble chat-msg'>
                    <div class='chat-bubble-header'>Joe Walsh</div>
                    ${safeText}
                </div>
            </div>`;
        safeRenderChatInterface(true, html);
    }
}

export function showHintsAndScroll() {
    const hints = document.getElementById("hints");
    if (hints) {
        hints.classList.remove("d-none", "invisible");
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

export function initUISubscriptions() {
    const store = appStore;
    let prevPoints = store.getState().listeningScore;
    let prevSpeaking = store.getState().speakingScore;
    let prevAttempts = store.getState().incorrectAttempts;
    let prevDayCount = store.getState().dayCount;
    let prevStreak = store.getState().currentStreak;

    const syncCurrentScore = (listeningScore) => {
        const element = document.getElementById('currentScore');
        if (element) {
            flashElement(element);
            element.textContent = listeningScore;
        }
    };
    syncCurrentScore(prevPoints);

    const syncSpeakingScore = (speakingScore) => {
        if (DOM.phrasesScore) {
            flashElement(DOM.phrasesScore);
            DOM.phrasesScore.textContent = `${speakingScore}`;
        }
    };
    syncSpeakingScore(prevSpeaking);

    const syncActivityDisplay = (dayCount, currentStreak) => {
        if (DOM.dayCountSpan) {
            DOM.dayCountSpan.textContent = dayCount;
            flashElement(DOM.dayCountSpan);
        }
        if (DOM.streakCountSpan) {
            DOM.streakCountSpan.textContent = currentStreak;
            flashElement(DOM.streakCountSpan);
        }
    };
    syncActivityDisplay(prevDayCount, prevStreak);

    store.subscribe((state) => {
        if (state.listeningScore !== prevPoints) {
            syncCurrentScore(state.listeningScore);
            prevPoints = state.listeningScore;
        }
        if (state.speakingScore !== prevSpeaking) {
            syncSpeakingScore(state.speakingScore);
            prevSpeaking = state.speakingScore;
        }
        if (state.incorrectAttempts > prevAttempts) {
            if (state.incorrectAttempts == 1 && DOM.heart1) DOM.heart1.classList.add("falling-image");
            else if (state.incorrectAttempts == 2 && DOM.heart2) DOM.heart2.classList.add("falling-image");
            else if (state.incorrectAttempts == 3 && DOM.heart3) DOM.heart3.classList.add("falling-image");
            prevAttempts = state.incorrectAttempts;
        } else if (state.incorrectAttempts === 0) {
            prevAttempts = 0;
        }
        if (state.dayCount !== prevDayCount || state.currentStreak !== prevStreak) {
            syncActivityDisplay(state.dayCount, state.currentStreak);
            prevDayCount = state.dayCount;
            prevStreak = state.currentStreak;
        }
    });
}

export function showGuestLoginModal() {
    const modalHtml = `
    <div class="modal fade" id="guestLoginModal" tabindex="-1" aria-labelledby="guestLoginModalLabel" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-dark text-white">
                <div class="modal-header border-secondary">
                    <h5 class="modal-title" id="guestLoginModalLabel">Welcome!</h5>
                </div>
                <div class="modal-body">
                    <p>You are currently not logged in. Log in or sign up to save your progress and access all features. Or, continue as a guest to try out the app.</p>
                    <div class="d-grid gap-2 mt-4">
                        <a href="login.html" class="btn btn-primary">Log In</a>
                        <a href="signup.html" class="btn btn-secondary">Sign Up</a>
                        <button type="button" class="btn btn-outline-light mt-2" data-bs-dismiss="modal">Continue as Guest</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    setTimeout(() => {
        if (typeof bootstrap !== 'undefined') {
            const guestModal = new bootstrap.Modal(document.getElementById('guestLoginModal'));
            guestModal.show();
        } else {
            console.error('Bootstrap is not loaded, unable to show guest login modal.');
        }
    }, 100);
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

    setTimeout(() => {
        document.getElementById('acceptBtn')?.addEventListener('click', onAccept);
        document.getElementById('rejectBtn')?.addEventListener('click', onReject);

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
    if (playerInstance) {
        if (typeof playerInstance.pause === 'function') {
            playerInstance.pause();
        } else if (playerInstance.video && !playerInstance.video.paused) {
            playerInstance.video.pause();
        }
    }

    const videoElements = document.querySelectorAll('video.ivp-video');
    videoElements.forEach(video => {
        if (!video.paused) {
            video.pause();
        }
    });
}

export function updateSpeakingScoreDisplay(score) {
    const safeScore = score !== undefined ? score : appStore.getState().speakingScore;
    if (DOM.phrasesScore) DOM.phrasesScore.textContent = `${safeScore}`;
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

export function prepareMediaUI() {
    if (DOM.mediaContainer) DOM.mediaContainer.classList.remove('d-none');
}

export function showPlaybackVideo() {
    if (DOM.speechText) {
        DOM.speechText.classList.remove('d-none');
        DOM.speechText.style.setProperty('display', 'block', 'important');
        DOM.speechText.style.setProperty('opacity', '1', 'important');
    }

    const videoWrapper = document.getElementById('playback-video-wrapper');
    const video = document.getElementById('playback-video') || DOM.playbackVideo;

    if (videoWrapper && video && DOM.chatBody) {
        videoWrapper.classList.remove('d-none');
        videoWrapper.style.setProperty('display', 'block', 'important');
        videoWrapper.style.setProperty('visibility', 'visible', 'important');
        videoWrapper.style.setProperty('opacity', '1', 'important');

        video.style.setProperty('display', 'block', 'important');
        video.style.setProperty('opacity', '1', 'important');

        // Match renderUserResponse structure so row-reverse styling applies correctly
        const chatWrapper = document.createElement('div');
        chatWrapper.className = 'chat-message-wrapper user-message-wrapper';
        chatWrapper.style.animation = 'popIn 0.3s ease-out forwards';

        const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
        const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.png';

        const avatar = document.createElement('img');
        avatar.src = userAvatarUrl;
        avatar.alt = userName;
        avatar.className = 'chat-avatar-inline';

        const bubble = document.createElement('div');
        bubble.className = 'userResponse chat-bubble-sent chat-msg p-1';
        bubble.style.backgroundColor = '#000';
        bubble.style.border = '2px solid #4facfe';
        bubble.style.overflow = 'hidden';
        bubble.style.borderRadius = '12px 12px 4px 12px';

        const header = document.createElement('div');
        header.className = 'chat-bubble-header';
        header.textContent = userName;
        header.style.color = '#fff';
        header.style.padding = '4px 8px';

        videoWrapper.classList.remove('mb-2');
        video.style.width = '100%';
        video.style.height = 'auto';
        video.style.maxHeight = '350px';
        video.style.objectFit = 'cover';

        bubble.appendChild(header);
        bubble.appendChild(videoWrapper);

        chatWrapper.appendChild(avatar);
        chatWrapper.appendChild(bubble);

        DOM.chatBody.appendChild(chatWrapper);

        setTimeout(() => {
            const lastMessage = DOM.chatBody.lastElementChild;
            if (lastMessage) {
                lastMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100);
    }
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
    webcamPreview.style.opacity = '0';

    if (DOM.mediaContainer) {
        DOM.mediaContainer.appendChild(webcamPreview);
    } else {
        webcamPreview.style.position = 'fixed';
        webcamPreview.style.bottom = '10px';
        webcamPreview.style.right = '10px';
        document.body.appendChild(webcamPreview);
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
}

export function hideWebcamPreview() {
    if (webcamPreview && webcamPreview.isConnected) webcamPreview.classList.add('d-none');
}

export function removeWebcamPreview() {
    if (webcamPreview) {
        webcamPreview.pause();
        webcamPreview.srcObject = null;
        webcamPreview.classList.add('d-none');
    }
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

        window._playbackObserver.observe(playbackVideo);

        playbackVideo.onloadedmetadata = () => {
            playbackVideo.style.display = 'block';
            if (autoplay) {
                playbackVideo.play().catch(e => console.warn('[Playback] autoplay failed:', e));
            }
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
    let textOnlyButton = document.getElementById('textOnlyButton');
    let btnGroup = document.getElementById('introButtonGroup');
    const centerBar = document.getElementById('bottomButtonBarCenter');

    if (isLessonIntro && !btnGroup && centerBar) {
        btnGroup = document.createElement('div');
        btnGroup.className = 'd-flex gap-2 w-100 align-items-center';
        btnGroup.id = 'introButtonGroup';
        centerBar.appendChild(btnGroup);
    }

    if (!continueButton) {
        continueButton = document.createElement('button');
        continueButton.id = 'continueButton';
    }
    continueButton.className = isLessonIntro ? 'btn btn-primary text-white w-33' : 'btn btn-primary text-white w-100';
    continueButton.innerHTML = isLessonIntro ? '<i class="bi bi-camera-video-fill text-white" style="font-size: 40px; font-weight: 900;"></i>' : '<i class="bi bi-chevron-right text-white" style="font-size: 40px; font-weight: 900;"></i>';
    continueButton.onclick = () => {
        if (isLessonIntro) {
            State.isTextMode = false;
            syncTextModeUI();
            if (State.isCameraOff) toggleCamera();
        }
        onClickCallback();
    };

    if (isLessonIntro) {
        if (!audioOnlyButton) {
            audioOnlyButton = document.createElement('button');
            audioOnlyButton.id = 'audioOnlyButton';
            audioOnlyButton.className = 'btn bg-transparent border-0 text-white w-33';
            audioOnlyButton.innerHTML = '<i class="bi bi-telephone-fill text-white" style="font-size: 40px; font-weight: 900;"></i>';
        }
        audioOnlyButton.onclick = () => {
            State.isTextMode = false;
            syncTextModeUI();
            if (!State.isCameraOff) toggleCamera();
            if (onAudioOnlyClickCallback) onAudioOnlyClickCallback();
            else onClickCallback();
        };

        if (!textOnlyButton) {
            textOnlyButton = document.createElement('button');
            textOnlyButton.id = 'textOnlyButton';
            textOnlyButton.className = 'btn bg-transparent border-0 text-white w-33';
            textOnlyButton.innerHTML = '<i class="bi bi-keyboard text-white" style="font-size: 40px; font-weight: 900;"></i>';
        }
        textOnlyButton.onclick = () => {
            State.isTextMode = true;
            State.isCameraOff = true;
            syncTextModeUI();
            onClickCallback();
        };
    }

    if (isLessonIntro && btnGroup) {
        btnGroup.innerHTML = '';
        if (audioOnlyButton) btnGroup.appendChild(audioOnlyButton);
        if (continueButton) btnGroup.appendChild(continueButton);
        if (textOnlyButton) btnGroup.appendChild(textOnlyButton);
        btnGroup.style.display = 'flex';
    } else {
        if (btnGroup) btnGroup.style.display = 'none';
        if (centerBar && continueButton) {
            centerBar.appendChild(continueButton);
            continueButton.style.display = 'inline-block';
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

    const preserved = DOM.mediaContainer.querySelectorAll('#ivp-container, #simple-ivp-container, #intro-call-widget, #webcam-preview');
    DOM.mediaContainer.innerHTML = '';

    preserved.forEach(el => {
        el.style.display = '';
        el.style.minHeight = '';

        if (el.id === 'intro-call-widget') {
            el.classList.add('d-none');
        } else if (el.id === 'webcam-preview') {
        } else {
            el.classList.remove('d-none');
            el.innerHTML = '';
        }

        DOM.mediaContainer.appendChild(el);
    });
}

export function renderImageInMediaContainer(imageUrl) {
    if (!DOM.mediaContainer) return;

    DOM.mediaContainer.classList.remove('d-none');
    DOM.mediaContainer.style.display = 'block';

    const existingPraise = DOM.mediaContainer.querySelectorAll('.praise-image-wrapper');
    existingPraise.forEach(el => el.remove());

    const div = document.createElement('div');
    div.className = 'text-center mb-3 praise-image-wrapper';
    div.innerHTML = `<img src="${imageUrl}" class="img-fluid rounded" alt="Praise" style="max-height: 250px; border: 3px solid #00f2fe; box-shadow: 0 0 15px rgba(0,242,254,0.5);">`;

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
        answersContainer.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'text-input-mode d-flex flex-column gap-2 p-3';

        const textarea = document.createElement('textarea');
        textarea.id = 'textInputAnswer';
        textarea.className = 'form-control';
        textarea.rows = 3;
        textarea.placeholder = placeholder || 'Type your answer...';
        textarea.setAttribute('aria-label', 'Type your answer');

        const submitBtn = document.createElement('button');
        submitBtn.id = 'submitTextAnswerBtn';
        submitBtn.className = 'btn btn-primary';
        submitBtn.textContent = submitText || 'Submit';
        submitBtn.disabled = false;

        const handleSubmit = () => {
            const value = textarea.value.trim();
            if (!value) return;
            submitBtn.disabled = true;
            textarea.disabled = true;
            handleSubmitCallback(value, submitBtn);
        };

        submitBtn.addEventListener('click', handleSubmit);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
            }
        });

        wrapper.appendChild(textarea);
        wrapper.appendChild(submitBtn);
        answersContainer.appendChild(wrapper);
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

export function handlecueUI(qIndex, questionData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction, userData, configData) {

    if (questionData.inputType === "speech" && questionData.videoUrl) State.repeatPointsHistory.push(appStore.getState().listeningScore);
    if (questionData.inputType === "ai" && questionData.videoUrl) State.rolePlayPointsHistory.push(appStore.getState().listeningScore);

    if (DOM.speechText) {
        const lang = userData?.native_language || State.userData?.native_language || 'en';
        const praiseResult = (questionData.inputType === "ai" || questionData.inputType === "speech") ? getRandomPraise('general', lang) : "";
        const feedbackText = (questionData.inputType === "ai" && englishLevelDeduction > 0)
            ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
            : getPraiseHTML(praiseResult);

        if (questionData.inputType !== "ai" && questionData.inputType !== "speech") {
            const localizedTrans = getLocalizedTranslation(translation, lang);

            const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
            const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.png';

            const correctWrapper = document.createElement('div');
            correctWrapper.className = 'chat-message-wrapper user-message-wrapper correct-answer-wrapper';

            const correctImg = document.createElement('img');
            correctImg.src = userAvatarUrl;
            correctImg.alt = userName;
            correctImg.className = 'chat-avatar-inline';

            const correctBubble = document.createElement('div');
            correctBubble.classList.add('correct-answer-display', 'chat-bubble-sent', 'chat-msg');

            const correctHeader = document.createElement('div');
            correctHeader.className = 'chat-bubble-header';
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
            praiseWrapper.className = 'chat-message-wrapper ai-message-wrapper';
            praiseWrapper.style.marginTop = '6px';

            const praiseImg = document.createElement('img');
            praiseImg.src = 'assets/img/teacherprofile.jpeg';
            praiseImg.alt = 'Joe Walsh';
            praiseImg.className = 'chat-avatar-inline';

            const praiseBubble = document.createElement('div');
            praiseBubble.classList.add('chat-bubble', 'chat-msg');

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
            chunks.push(praiseWrapper, questionData.headsUp);

            renderAIFeedback(chunks);
        } else {
            const chunks = [];
            if (Array.isArray(explanation)) chunks.push(...explanation);
            else if (explanation) chunks.push(explanation);
            chunks.push(feedbackText ? `<strong>${feedbackText}</strong>` : "", questionData.headsUp);

            renderAIFeedback(chunks);
        }
    }

    Media.playSound('correct-sound');

    markButtonAsCorrect(button);
}

export function handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, question, silent = false, userData, configData) {
    appStore.getState().incrementIncorrectAttempts();

    if (!silent && !State.isTextMode && (questionData.inputType === "lessonIntro" || questionData.inputType === "speech" || questionData.inputType === "ai")) {
        showPlaybackVideo();
    }

    if ((questionData.inputType === "speech" || questionData.inputType === "ai") && questionData.videoUrl) {
        appStore.getState().deductListeningScore(25);
        pointLoss.show(DOM.micStatusText, 25);
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            State.rolePlayPointsHistory.push(appStore.getState().listeningScore);
        }
    }

    if (silent) {
        animateHeartLoss(appStore.getState().incorrectAttempts);
        Media.playSound('incorrect-sound');
        return;
    }

    if (questionData.inputType === "ai" && userResponse) {
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            State.rolePlayPointsHistory.push(appStore.getState().listeningScore);
        }

        const teacherTextStr = appStore.getState().incorrectAttempts === 1
            ? Strings.get('try_again_1', userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', userData?.native_language)
                : `${Strings.get('failed_continue_correct', userData?.native_language)}<br>"${cue}"`;

        const teacherDiv = document.createElement('div');
        const teacherStrong = document.createElement('strong');
        teacherStrong.innerHTML = teacherTextStr;
        teacherDiv.appendChild(teacherStrong);

        let headsUpNode = '';
        if (questionData.headsUp) {
            const headsUpText = appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_try_again', userData?.native_language) : questionData.headsUp;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = headsUpText;
            headsUpNode = tempDiv;
        }

        let possibleAnswerNode = '';
        if (questionData.possibleAnswer && appStore.getState().incorrectAttempts > 2) {
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
        const selectedWords = [...new Set(normalizeduserResponse.split(/\\s+/))];
        const correctWords = [...new Set(normalizedcue.split(/\\s+/))];
        const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
        const correct = new Set(); const incorrect = new Set();

        selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

        const correctUl = `<ul class='card-text correctWords list-inline' id='correctWords'>${Array.from(correct).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;
        const incorrectUl = `<ul class='card-text incorrectWords list-inline' id='incorrectWords'>${Array.from(incorrect).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;

        const teacherText = appStore.getState().incorrectAttempts === 1
            ? Strings.get('try_again_1', State.userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', State.userData?.native_language)
                : `${Strings.get('failed_continue', State.userData?.native_language)}<br><br>Correct:<br>"${cue}"`;

        const headsUpStr = questionData.headsUp
            ? (appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_repeat_video', State.userData?.native_language) : questionData.headsUp)
            : '';

        const chunks = [`<strong>${teacherText}</strong><br><br>${correctUl}${incorrectUl}`];
        if (Array.isArray(explanation)) chunks.push(...explanation);
        else if (explanation) chunks.push(explanation);
        chunks.push(headsUpStr);

        renderAIFeedback(chunks);
    }

    animateHeartLoss(appStore.getState().incorrectAttempts);

    Media.playSound('incorrect-sound');

    const answersContainer = button.parentElement;
    if (questionData.inputType !== "text") {
        markButtonAsIncorrect(button, answersContainer, cue);
    } else {
        markButtonAsIncorrect(button, null, null);
    }
}