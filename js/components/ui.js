// --- modules/ui.js ---
import { State } from '../modules/state.js';
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import getRandomPraise from '../data/praise.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { Media } from '../modules/media.js';
import { pointLoss } from './point-loss-animation.js';

const AI_TUTOR_NAME = 'AI Tutor';
const AI_TUTOR_AVATAR = 'assets/img/ai.webp';

export function syncTextModeUI() {
    const pronunciationScore = DOM.pronunciationScore;
    const flowScore = DOM.flowScore;

    if (State.isTextMode) {
        if (pronunciationScore && pronunciationScore.parentElement) {
            pronunciationScore.parentElement.classList.add('d-none');
        }
        if (flowScore && flowScore.parentElement) {
            flowScore.parentElement.classList.add('d-none');
        }

        if (DOM.micBtn) DOM.micBtn.classList.add('d-none');
        if (DOM.txtBtn) DOM.txtBtn.classList.remove('d-none');
        console.log('[UI] Text mode: hiding speaking/flow scores, swapping mic for keyboard');
    } else {
        if (pronunciationScore && pronunciationScore.parentElement) {
            pronunciationScore.parentElement.classList.remove('d-none');
        }
        if (flowScore && flowScore.parentElement) {
            flowScore.parentElement.classList.remove('d-none');
        }

        if (DOM.micBtn) DOM.micBtn.classList.remove('d-none');
        if (DOM.txtBtn) DOM.txtBtn.classList.add('d-none');
        console.log('[UI] Camera/Mic mode: showing speaking/flow scores, swapping keyboard for mic');
    }
}

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
    get statsContainer() { return document.getElementById("stats-container"); },
    get progressbar() { return document.getElementById('progress'); },
    get progressBarFill() { return document.getElementById("progress-bar"); },
    get closeAndProgress() { return document.getElementById('closeAndProgress'); },
    get micStatusText() { return document.getElementById("micStatusText"); },
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

export function updateCurrentScoreDisplay(listeningScore) {
    const points = listeningScore !== undefined ? listeningScore : appStore.getState().listeningScore;
    const element = document.getElementById('listeningScore');
    if (element) {
        flashElement(element);
        element.textContent = points;
    }
}

export function animatePointLoss(amount) {
    const element = document.getElementById('listeningScore');
    if (element && pointLoss) {
        pointLoss.show(element, amount);
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
    DOM.speechText.style.setProperty('display', 'flex', 'important');

    if (DOM.bottomOverlay) {
        DOM.bottomOverlay.style.setProperty('display', 'none', 'important');
    }

    document.body.classList.add('chat-mode-active');
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
}

export function renderUserResponse(text, statsHtml = "") {
    const safeText = escapeHTML(text);
    const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
    const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.webp';
    const html = `
        <div class="chat-message-row chat-message-row--user">
            <img src="${userAvatarUrl}" alt="${userName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--user">
                <div class="chat-bubble-header">${userName}</div>
                ${safeText}
            </div>
        </div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}

export function renderAIAnalysisLoading(text) {
    hideWhisperReviewUI();
    const defaultText = Strings.get('ai_analyzing', State.userData?.native_language);
    const displayText = text || defaultText;
    const aiAvatarUrl = AI_TUTOR_AVATAR;
    const html = `
        <div class="chat-message-row chat-message-row--system" id="ai-loading-status">
            <img src="${aiAvatarUrl}" alt="${AI_TUTOR_NAME}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system">
                <div class="chat-bubble-header">${AI_TUTOR_NAME}</div>
                <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${displayText}</strong>
            </div>
        </div>`;
    safeRenderChatInterface(true, html);
}

export function createHeaderHTML(text) {
    return "";
}

export function createPragmaticsBubbleHTML(headingHTML, contentHTML, correctionHTML = "", botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.webp") {
    return `
        <div class="chat-message-row chat-message-row--system">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system">
                <div class="chat-bubble-header">${botName}</div>
                ${contentHTML}${correctionHTML ? ` ${correctionHTML}` : ''}
            </div>
        </div>`;
}

export function createStatsBubbleHTML(header, statsParts, botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.webp") {
    const partsHtml = statsParts && statsParts.length > 0
        ? ` ${statsParts.join('. ')}`
        : '';
    return `
        <div class="chat-message-row chat-message-row--system">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system" style="border-left: 4px solid #17a2b8;">
                <div class="chat-bubble-header">${botName}</div>
                <span>${header}${partsHtml}</span>
            </div>
        </div>`;
}

export function createGrammarDiffHTML(original, correction, headingText = "", botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.webp") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class="chat-message-row chat-message-row--system">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system">
                <div class="chat-bubble-header">${botName}</div>
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
                if (chunk.includes("chat-message-row") || chunk.includes("chat-message-bubble")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chunk;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                } else {
                    const row = document.createElement('div');
                    row.className = 'chat-message-row chat-message-row--system';

                    const img = document.createElement('img');
                    img.src = 'assets/img/teacherprofile.webp';
                    img.alt = 'Joe Walsh';
                    img.className = 'chat-avatar-inline';

                    const bubble = document.createElement('div');
                    bubble.className = 'chat-message-bubble chat-message-bubble--system';

                    const header = document.createElement('div');
                    header.className = 'chat-bubble-header';
                    header.textContent = 'Joe Walsh';
                    bubble.appendChild(header);

                    const content = document.createElement('span');
                    content.innerHTML = chunk;
                    bubble.appendChild(content);

                    row.appendChild(img);
                    row.appendChild(bubble);
                    fragment.appendChild(row);
                }
            } else if (chunk instanceof Node) {
                if (chunk.nodeType === Node.ELEMENT_NODE && !chunk.classList.contains('chat-message-bubble') && !chunk.classList.contains('chat-message-row')) {
                    const row = document.createElement('div');
                    row.className = 'chat-message-row chat-message-row--system';

                    const img = document.createElement('img');
                    img.src = 'assets/img/teacherprofile.webp';
                    img.alt = 'Joe Walsh';
                    img.className = 'chat-avatar-inline';

                    const bubble = document.createElement('div');
                    bubble.className = 'chat-message-bubble chat-message-bubble--system';

                    const header = document.createElement('div');
                    header.className = 'chat-bubble-header';
                    header.textContent = 'Joe Walsh';
                    bubble.appendChild(header);
                    bubble.appendChild(chunk);

                    row.appendChild(img);
                    row.appendChild(bubble);
                    fragment.appendChild(row);
                } else {
                    fragment.appendChild(chunk);
                }
            }
        });

    safeRenderChatInterface(true, fragment);
}

export function hidePreloader() {
    const preloader = document.getElementById('appLoadingImageDiv');
    if (preloader) preloader.style.display = 'none';
}

export function removeAILoadingStatus() {
    const loadingStatus = document.getElementById('ai-loading-status');
    if (loadingStatus) loadingStatus.remove();
}

export function renderHangmanHint(html) {
    const hintUncommonWords = document.getElementById("hintUncommonWords");
    if (hintUncommonWords) hintUncommonWords.innerHTML = html;
}

export function showMicWarning(message) {
    if (DOM.micStatusText) {
        DOM.micStatusText.innerHTML = `<div class='text-center text-danger'>${message}</div>`;
    }
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
    if (DOM.micStatusText) {
        DOM.micStatusText.innerHTML = `<div class='text-center'>${questionText || ""}</div>`;
    }
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
    hideWhisperReviewUI();
    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
        document.body.appendChild(videoWrapper);
    }

    DOM.chatBody.innerHTML = '';
    DOM.speechText.classList.add('d-none');
    DOM.speechText.style.removeProperty('display');

    if (DOM.bottomOverlay) {
        DOM.bottomOverlay.style.removeProperty('display');
    }

    document.body.classList.remove('chat-mode-active');

    hideTutorChatInput();
    hideAnswerInputArea();
    clearChatHeaderScores();
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

export function clearChatHeaderScores() {
    Object.values(SCORE_SPAN_MAP).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

export function updateChatHeaderScores(feedbackData) {
    if (!feedbackData || !Array.isArray(feedbackData.sections)) return;
    feedbackData.sections.forEach(section => {
        const spanId = SCORE_SPAN_MAP[section.key];
        if (!spanId) return;
        const el = document.getElementById(spanId);
        if (!el) return;
        el.textContent = section.score === 100 ? 'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¯' : String(Math.round(section.score));
    });
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
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            DOM.tutorChatSendBtn.click();
        }
    });
}

export function showTutorChatInput() {
    if (DOM.tutorChatInputArea) {
        DOM.tutorChatInputArea.classList.remove('d-none');
        DOM.tutorChatInputArea.style.setProperty('display', 'block', 'important');
    }
}

export function hideTutorChatInput() {
    if (DOM.tutorChatInputArea) {
        DOM.tutorChatInputArea.classList.add('d-none');
        DOM.tutorChatInputArea.style.setProperty('display', 'none', 'important');
    }
}

export function hideAnswerInputArea() {
    if (DOM.answerInputArea) {
        DOM.answerInputArea.classList.add('d-none');
    }
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

export function renderTutorMessage(text, isUser) {
    if (isUser) {
        renderUserResponse(text);
    } else {
        const safeText = escapeHTML(text);
        const aiAvatarUrl = AI_TUTOR_AVATAR;
        const html = `
            <div class="chat-message-row chat-message-row--system">
                <img src="${aiAvatarUrl}" alt="${AI_TUTOR_NAME}" class="chat-avatar-inline" />
                <div class="chat-message-bubble chat-message-bubble--system">
                    <div class="chat-bubble-header">${AI_TUTOR_NAME}</div>
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
    if (DOM.mediaViewport) DOM.mediaViewport.classList.add('d-none');
    hideAnswerInputArea();
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
    let prevFlow = store.getState().flowScore;
    let prevAttempts = store.getState().incorrectAttempts;
    let prevDayCount = store.getState().dayCount;
    let prevStreak = store.getState().currentStreak;
    let prevUserFirstName = store.getState().userFirstName;

    const updateChatHeader = (userFirstName) => {
        const header = document.getElementById('chat-window-header');
        if (header) {
            if (userFirstName) {
                header.textContent = `${userFirstName}'s Fluency Team`;
            } else {
                header.textContent = `Your Fluency Team`;
            }
        }
    };
    updateChatHeader(prevUserFirstName);

    const chatList = document.getElementById('chat-message-list');
    if (chatList) {
        const observer = new MutationObserver(() => {
            setTimeout(() => {
                chatList.scrollTo({
                    top: chatList.scrollHeight,
                    behavior: 'smooth'
                });
            }, 50);
        });
        observer.observe(chatList, { childList: true, subtree: true });
    }

    const syncCurrentScore = (listeningScore) => {
        const element = document.getElementById('listeningScore');
        if (element) {
            flashElement(element);
            element.textContent = listeningScore;
        }
    };
    syncCurrentScore(prevPoints);

    const syncSpeakingScore = (speakingScore) => {
        if (DOM.pronunciationScore) {
            flashElement(DOM.pronunciationScore);
            DOM.pronunciationScore.textContent = `${speakingScore}`;
        }
    };
    syncSpeakingScore(prevSpeaking);

    const syncFlowScore = (flowScore) => {
        if (DOM.flowScore) {
            flashElement(DOM.flowScore);
            DOM.flowScore.textContent = `${flowScore}`;
        }
    };
    syncFlowScore(prevFlow);

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
        if (state.flowScore !== prevFlow) {
            syncFlowScore(state.flowScore);
            prevFlow = state.flowScore;
        }
        if (state.incorrectAttempts > prevAttempts) {
            prevAttempts = state.incorrectAttempts;
        } else if (state.incorrectAttempts === 0) {
            prevAttempts = 0;
        }
        if (state.dayCount !== prevDayCount || state.currentStreak !== prevStreak) {
            syncActivityDisplay(state.dayCount, state.currentStreak);
            prevDayCount = state.dayCount;
            prevStreak = state.currentStreak;
        }
        if (state.userFirstName !== prevUserFirstName) {
            updateChatHeader(state.userFirstName);
            prevUserFirstName = state.userFirstName;
        }
    });

    if (DOM.txtBtn) {
        DOM.txtBtn.onclick = () => {
            if (DOM.answerInputArea) {
                const isHiding = !DOM.answerInputArea.classList.contains('d-none');

                if (isHiding) {
                    // --- CLOSING ---
                    DOM.answerInputArea.classList.add('d-none');
                    window.isMicActive = false;

                    // Resume video
                    const player = State.player || window.currentVideoPlayer;
                    if (player && player.play) {
                        player.play().catch(e => console.warn('[UI] Video resume failed:', e));
                    }
                    console.log('[UI] Text area hidden, video resumed');
                } else {
                    // --- OPENING ---
                    DOM.answerInputArea.classList.remove('d-none');
                    window.isMicActive = true;

                    // Pause video
                    Media.pauseVideoIfPlaying();

                    // Hide hints
                    hideHints();

                    // Focus
                    if (DOM.answerInputField) {
                        setTimeout(() => DOM.answerInputField.focus(), 100);
                    }
                    console.log('[UI] Text area shown, video paused');
                }
            }
        };
    }
}

export function showGuestLoginModal() {
    const dialog = document.getElementById('guestLoginModal');
    const loginBtn = document.getElementById('guestLoginBtn');
    const signupBtn = document.getElementById('guestSignupBtn');
    const continueBtn = document.getElementById('guestContinueBtn');

    if (!dialog || !loginBtn || !signupBtn || !continueBtn) {
        console.warn('[GuestLoginModal] Required elements not found');
        return;
    }

    // Set localized strings
    const lang = State.userData?.native_language || 'en';
    const titleEl = document.getElementById('guestLoginModalTitleText');
    const bodyEl = document.getElementById('guestLoginModalBodyText');
    const loginBtnTextEl = document.getElementById('guestLoginBtnText');
    const signupBtnTextEl = document.getElementById('guestSignupBtnText');
    const continueBtnTextEl = document.getElementById('guestContinueBtnText');

    if (titleEl) titleEl.innerHTML = Strings.get('guest_modal_title', lang);
    if (bodyEl) bodyEl.innerHTML = Strings.get('guest_modal_body', lang);
    if (loginBtnTextEl) loginBtnTextEl.innerHTML = Strings.get('guest_modal_login', lang);
    if (signupBtnTextEl) signupBtnTextEl.innerHTML = Strings.get('guest_modal_signup', lang);
    if (continueBtnTextEl) continueBtnTextEl.innerHTML = Strings.get('guest_modal_continue', lang);

    const currentUrl = window.location.pathname + window.location.search;
    loginBtn.href = `login.html?redirect=${encodeURIComponent(currentUrl)}`;
    signupBtn.href = `signup.html?redirect=${encodeURIComponent(currentUrl)}`;

    const closeDialog = () => {
        if (dialog.close) dialog.close();
        else dialog.style.display = 'none';
    };

    continueBtn.onclick = () => {
        closeDialog();
        console.log('[GuestLoginModal] User chose to continue as guest');
    };

    // Show as native dialog
    if (dialog.showModal) {
        dialog.showModal();
    } else {
        dialog.style.display = 'block';
    }
}
export function hideWhisperReviewUI() {
    if (DOM.whisperReviewContainer) {
        DOM.whisperReviewContainer.classList.add("d-none");
    }
}

export function showCriticalError(message) {
    if (DOM.criticalErrorContainer && DOM.criticalErrorMessage) {
        DOM.criticalErrorMessage.innerHTML = message || "An unexpected error occurred.";
        DOM.criticalErrorContainer.classList.remove("d-none");
        if (DOM.mediaViewport) DOM.mediaViewport.classList.remove("d-none");
        console.error("[UI] Critical Error Shown:", message);
    }
}

export function hideCriticalError() {
    if (DOM.criticalErrorContainer) {
        DOM.criticalErrorContainer.classList.add("d-none");
    }
}

export function renderWhisperReviewUI(transcript, timeLeft, onAccept, onReject) {
    removeAILoadingStatus();
    if (DOM.micStatusText) DOM.micStatusText.innerHTML = "";
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
    if (DOM.pronunciationScore) DOM.pronunciationScore.textContent = `${safeScore}`;
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
    if (DOM.mediaViewport) DOM.mediaViewport.classList.remove('d-none');
}

export function showPlaybackVideo() {
    if (DOM.speechText) {
        DOM.speechText.classList.remove('d-none');
        DOM.speechText.style.setProperty('display', 'flex', 'important');
        DOM.speechText.style.setProperty('opacity', '1', 'important');
    }

    const videoWrapper = document.getElementById('playback-video-wrapper');
    const video = document.getElementById('playback-video') || DOM.playbackVideo;

    if (videoWrapper && video && DOM.chatBody) {
        if (DOM.chatBody.contains(videoWrapper)) {
            videoWrapper.classList.remove('d-none');
            videoWrapper.style.setProperty('display', 'block', 'important');
            video.style.setProperty('display', 'block', 'important');
            video.muted = State.isPlaybackMuted;
            video.play().catch(e => console.warn('[UI] Playback resume failed:', e));
            return;
        }

        videoWrapper.classList.remove('d-none');
        videoWrapper.style.setProperty('display', 'block', 'important');
        videoWrapper.style.setProperty('visibility', 'visible', 'important');
        videoWrapper.style.setProperty('opacity', '1', 'important');

        video.style.setProperty('display', 'block', 'important');
        video.style.setProperty('opacity', '1', 'important');

        const row = document.createElement('div');
        row.className = 'chat-message-row chat-message-row--user';
        row.style.animation = 'popIn 0.3s ease-out forwards';

        const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
        const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.webp';

        const avatar = document.createElement('img');
        avatar.src = userAvatarUrl;
        avatar.alt = userName;
        avatar.className = 'chat-avatar-inline';

        const bubble = document.createElement('div');
        bubble.className = 'chat-message-bubble chat-message-bubble--user p-1';
        bubble.style.backgroundColor = '#000';
        bubble.style.border = '2px solid #4facfe';
        bubble.style.overflow = 'hidden';

        bubble.style.setProperty('min-width', '0', 'important');
        bubble.style.setProperty('width', 'max-content');

        videoWrapper.classList.remove('mb-2');
        videoWrapper.style.width = '100px';
        videoWrapper.style.height = '178px';
        videoWrapper.style.position = 'relative'; // Reset from absolute
        videoWrapper.style.top = '';
        videoWrapper.style.left = '';
        videoWrapper.style.right = '';

        video.style.width = '100%';
        video.style.height = '100%';
        video.style.maxHeight = 'none';
        video.style.borderRadius = '8px';
        video.style.objectFit = 'cover';

        bubble.appendChild(videoWrapper);
        row.appendChild(avatar);
        row.appendChild(bubble);

        DOM.chatBody.appendChild(row);

        video.muted = State.isPlaybackMuted;
        video.play().catch(e => console.warn('[UI] Playback initial play failed:', e));

        setTimeout(() => {
            if (DOM.chatBody) {
                DOM.chatBody.scrollTo({ top: DOM.chatBody.scrollHeight, behavior: 'smooth' });
            }
        }, 100);
    }
}

export function isWebcamPreviewVisible() {
    const wrapper = document.getElementById('pip-wrapper');
    return wrapper && !wrapper.classList.contains('d-none');
}

export function createWebcamPreview() {
    // We no longer create the element. We just grab your hardcoded one.
    webcamPreview = document.getElementById('webcam-preview');
    return webcamPreview;
}

export function ensureWebcamPreview(stream) {
    if (!stream) return null;

    webcamPreview = document.getElementById('webcam-preview');
    const pipWrapper = document.getElementById('pip-wrapper');

    if (!webcamPreview || !pipWrapper) {
        console.error("Hardcoded PIP elements not found in the DOM.");
        return null;
    }

    // Attach the video stream
    if (webcamPreview.srcObject !== stream) {
        webcamPreview.srcObject = stream;
    }

    // Reveal the container securely
    if (pipWrapper.classList.contains('d-none')) {
        pipWrapper.classList.remove('d-none');
        // Let your CSS handle the animations, no inline transitions here!
    }

    // Ensure it plays
    setTimeout(() => {
        if (webcamPreview.readyState >= 2 || webcamPreview.paused) {
            webcamPreview.play().catch(e => console.log('Webcam play failed:', e));
        }
    }, 100);

    return webcamPreview;
}

export function hideWebcamPreview() {
    const pipWrapper = document.getElementById('pip-wrapper');
    if (pipWrapper) {
        pipWrapper.classList.add('d-none');
    }
}

export function removeWebcamPreview() {
    webcamPreview = document.getElementById('webcam-preview');
    const pipWrapper = document.getElementById('pip-wrapper');

    if (webcamPreview) {
        webcamPreview.pause();
        webcamPreview.srcObject = null;
    }
    if (pipWrapper) {
        pipWrapper.classList.add('d-none');
    }
}

export function toggleCamera() {
    // 1. Flip the application state
    State.isCameraOff = !State.isCameraOff;

    // 2. Update the Liquid UI visually
    const pipWrapper = document.getElementById('pip-wrapper');
    if (pipWrapper) {
        if (State.isCameraOff) {
            // Hide the self-view when the camera is toggled off
            pipWrapper.classList.add('d-none');
        } else {
            // Bring the self-view back when toggled on
            pipWrapper.classList.remove('d-none');
        }
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

        playbackVideo.onloadedmetadata = () => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (wrapper) {
                const videoFrame = document.querySelector('.video-frame');
                if (videoFrame && wrapper.parentElement !== videoFrame) {
                    videoFrame.appendChild(wrapper);
                }
                wrapper.classList.remove('d-none');
                wrapper.style.display = 'flex';

                // Clear any inline styles set by showPlaybackVideo chat bubble conversion
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


export function showContinueButton(isLessonIntro, onClickCallback, onAudioOnlyClickCallback) {
    if (isLessonIntro) {
        // 1. Handle Intro State (Toggle Bottom Control Bar)
        const standardMic = document.getElementById('state-standard-mic');
        const introChoices = document.getElementById('state-intro-choices');

        const videoBtn = document.getElementById('continueButton');
        const audioBtn = document.getElementById('audioOnlyButton');
        const textBtn = document.getElementById('textOnlyButton');

        // Swap the visible states
        if (standardMic) standardMic.classList.add('d-none');
        if (introChoices) {
            introChoices.classList.remove('d-none');
            introChoices.style.setProperty('display', 'flex', 'important');
        }

        // Attach event listeners to the hardcoded buttons
        if (videoBtn) {
            videoBtn.onclick = () => {
                State.isTextMode = false;
                syncTextModeUI();
                if (State.isCameraOff) toggleCamera();
                onClickCallback();
            };
        }

        if (audioBtn) {
            audioBtn.onclick = () => {
                State.isTextMode = false;
                syncTextModeUI();
                if (!State.isCameraOff) toggleCamera();
                if (onAudioOnlyClickCallback) onAudioOnlyClickCallback();
                else onClickCallback();
            };
        }

        if (textBtn) {
            textBtn.onclick = () => {
                State.isTextMode = true;
                State.isCameraOff = true;
                syncTextModeUI();
                onClickCallback();
            };
        }

        return videoBtn;

    } else {
        // 2. Handle Mid-Lesson State (Inject Incoming Video Message Widget into Chat)
        const chatMessageList = document.getElementById('chat-message-list');
        let nextButtonRow = document.getElementById('continueButtonRow');

        if (!nextButtonRow && chatMessageList) {
            nextButtonRow = document.createElement('div');
            nextButtonRow.className = 'chat-message-row chat-message-row--system';
            nextButtonRow.id = 'continueButtonRow';

            // Create avatar inline
            const avatar = document.createElement('img');
            avatar.src = 'assets/img/teacherprofile.webp';
            avatar.alt = 'Joe Walsh';
            avatar.className = 'chat-avatar-inline';
            nextButtonRow.appendChild(avatar);

            // Create chat bubble
            const bubble = document.createElement('div');
            bubble.className = 'chat-message-bubble chat-message-bubble--system incoming-call-bubble';

            // Create Tutor Header
            const header = document.createElement('div');
            header.className = 'chat-bubble-header';
            header.textContent = 'Joe Walsh';
            bubble.appendChild(header);

            // Determine active mode details (video, audio, text)
            let iconClass = 'bi-camera-video-fill'; // Default to video
            let actionTextKey = 'widget_action_video';

            if (State.isTextMode) {
                iconClass = 'bi-keyboard-fill';
                actionTextKey = 'widget_action_text';
            } else if (State.isCameraOff) {
                iconClass = 'bi-telephone-fill';
                actionTextKey = 'widget_action_audio';
            }

            // Retrieve localized strings
            const lang = State.userData?.native_language || 'en';
            const incomingLabel = Strings.get('widget_incoming', lang) || 'INCOMING';
            const actionText = Strings.get(actionTextKey, lang) || 'Tap to answer...';

            // Create incoming video widget button element
            const nextButton = document.createElement('div');
            nextButton.id = 'lessonNextButton';
            nextButton.className = 'incoming-video-widget ringing-animation';
            nextButton.innerHTML = `
                <div class="incoming-video-inner">
                    <div class="incoming-video-header">
                        <i class="bi ${iconClass} text-info pulse-camera"></i>
                        <span>${incomingLabel}</span>
                    </div>
                    <div class="incoming-video-caller">
                        <span class="caller-name">Joe Walsh</span>
                        <span class="caller-action">${actionText}</span>
                    </div>
                    <div class="incoming-video-btn-wrapper">
                        <div class="btn-pulse-ring"></div>
                        <button class="incoming-video-btn" aria-label="Answer Call">
                            <i class="bi ${iconClass}"></i>
                        </button>
                    </div>
                </div>
            `;

            nextButton.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClickCallback();
                nextButtonRow.remove();
            };

            bubble.appendChild(nextButton);
            nextButtonRow.appendChild(bubble);
            chatMessageList.appendChild(nextButtonRow);

            // Auto-scroll to ensure the widget is visible
            setTimeout(() => {
                chatMessageList.scrollTo({ top: chatMessageList.scrollHeight, behavior: 'smooth' });
            }, 100);
        }

        return document.getElementById('lessonNextButton');
    }
}

export function hideContinueButton() {
    // 1. Revert Bottom Bar back to standard mic
    const standardMic = document.getElementById('state-standard-mic');
    const introChoices = document.getElementById('state-intro-choices');

    if (introChoices) {
        introChoices.classList.add('d-none');
        introChoices.style.removeProperty('display');
    }
    if (standardMic) standardMic.classList.remove('d-none');

    // 2. Remove the mid-lesson next button if it's in the chat
    const nextBtnRow = document.getElementById('continueButtonRow');
    if (nextBtnRow) nextBtnRow.remove();
}

export function showLessonSuccessState() {
    const standardMic = document.getElementById('state-standard-mic');
    const lessonSuccess = document.getElementById('state-lesson-success');

    if (standardMic) standardMic.classList.add('d-none');
    if (lessonSuccess) lessonSuccess.classList.remove('d-none');
}

export function renderFallbackContinueButton(text, onClickCallback) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = onClickCallback;
    document.body.appendChild(btn);
}

export function resetUIForNewStep(isLessonIntro, hasUserData) {
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

    // 4. Reset the visibility of the parent container states
    const lessonSuccess = document.getElementById('state-lesson-success');
    if (lessonSuccess) {
        lessonSuccess.classList.add('d-none');
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
}

export function toggleScoresAndHearts(show) {
    if (DOM.statsContainer) {
        if (show) DOM.statsContainer.classList.remove('d-none');
        else DOM.statsContainer.classList.add('d-none');
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
            el.innerHTML = '';
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

export function renderSpeechInputUI(answerContent, handleHintCallback, handleRevealClickCallback, toggleSpeechCallback) {
    if (State.isTextMode) {
        console.log('[UI] renderSpeechInputUI: Bypassing voice UI in text mode');
        return;
    }
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

    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
        const newMicBtn = micBtn.cloneNode(true);
        newMicBtn.className = 'btn call-btn toggled-off';
        newMicBtn.style.display = 'flex'; // Force visibility
        newMicBtn.disabled = false;
        newMicBtn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';

        micBtn.parentNode.replaceChild(newMicBtn, micBtn);
        newMicBtn.addEventListener('click', toggleSpeechCallback);
    }
}

export function renderTextInputUI(placeholder, submitText, handleSubmitCallback) {
    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.remove('d-none');
    if (DOM.statsContainer) DOM.statsContainer.classList.remove('d-none');
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");

    if (DOM.answerInputArea && DOM.answerInputField && DOM.answerSubmitBtn) {
        // Keep hidden by default so video is visible
        DOM.answerInputArea.classList.add('d-none');

        DOM.answerInputField.placeholder = placeholder || 'Type your answer...';
        DOM.answerInputField.disabled = false;
        DOM.answerInputField.classList.remove('disabled');
        DOM.answerInputField.value = '';

        DOM.answerSubmitBtn.disabled = false;
        DOM.answerSubmitBtn.classList.remove('disabled');
        DOM.answerSubmitBtn.innerHTML = '<i class="bi bi-send-fill"></i>';

        // Clear previous event listeners
        const newSubmitBtn = DOM.answerSubmitBtn.cloneNode(true);
        DOM.answerSubmitBtn.parentNode.replaceChild(newSubmitBtn, DOM.answerSubmitBtn);

        const handleSubmit = () => {
            const value = DOM.answerInputField.value.trim();
            console.log('[UI] handleSubmit triggered. Value:', value);
            if (!value) return;
            newSubmitBtn.disabled = true;
            DOM.answerInputField.disabled = true;
            console.log('[UI] Calling handleSubmitCallback...');
            handleSubmitCallback(value, newSubmitBtn);
        };

        newSubmitBtn.addEventListener('click', handleSubmit);

        const newInputField = DOM.answerInputField.cloneNode(true);
        DOM.answerInputField.parentNode.replaceChild(newInputField, DOM.answerInputField);

        newInputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                console.log('[UI] Ctrl+Enter detected - submitting');
                handleSubmit();
            }
            // Normal Enter will now create a carriage return by default in the textarea
        });

        console.log('[UI] renderTextInputUI completed. Listeners attached to new nodes.');

        // Ensure it's focused
        setTimeout(() => newInputField.focus(), 100);
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
    if (DOM.statsContainer) DOM.statsContainer.classList.remove('d-none');

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

export function showMessageInStepsContainer(messageHTML) {
    const container = document.getElementById('steps-container');
    if (container) {
        container.innerHTML = `<div class="text-center">${messageHTML}</div>`;
    }
}

export function showInitializationErrorMessage(messageHTML) {
    showCriticalError(messageHTML);
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

    if (stepData.stepType === "closedResponse" && stepData.videoUrl) State.repeatPointsHistory.push(appStore.getState().listeningScore);
    if (stepData.stepType === "openResponse" && stepData.videoUrl) State.rolePlayPointsHistory.push(appStore.getState().listeningScore);

    if (DOM.speechText) {
        const lang = userData?.native_language || State.userData?.native_language || 'en';
        const praiseResult = (stepData.stepType === "openResponse" || stepData.stepType === "closedResponse") ? getRandomPraise('general', lang) : "";
        const feedbackText = (stepData.stepType === "openResponse" && englishLevelDeduction > 0)
            ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
            : getPraiseHTML(praiseResult);

        if (stepData.stepType !== "openResponse" && stepData.stepType !== "closedResponse") {
            const localizedTrans = getLocalizedTranslation(translation, lang);

            const userName = getFirstName(appStore.getState().userData?.display_name || State.userData?.display_name);
            const userAvatarUrl = appStore.getState().userData?.profilepicurl || State.userData?.profilepicurl || 'assets/img/userprofile.webp';

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
            praiseImg.src = 'assets/img/teacherprofile.webp';
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
        showPlaybackVideo();
    }

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) {
        appStore.getState().deductListeningScore(25);
        pointLoss.show(DOM.micStatusText, 25);
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            State.rolePlayPointsHistory.push(appStore.getState().listeningScore);
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
        if (stepData.headsUp) {
            const headsUpText = appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_try_again', userData?.native_language) : stepData.headsUp;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = headsUpText;
            headsUpNode = tempDiv;
        }

        let possibleAnswerNode = '';
        if (stepData.possibleAnswer && appStore.getState().incorrectAttempts > 2) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = `${Strings.get('example_correct_answer', State.userData?.native_language)}<br>${stepData.possibleAnswer}`;
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
            ? Strings.get('try_again_1', State.userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', State.userData?.native_language)
                : `${Strings.get('failed_continue', State.userData?.native_language)}<br><br>Correct:<br>"${cue}"`;

        const headsUpStr = stepData.headsUp
            ? (appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_repeat_video', State.userData?.native_language) : stepData.headsUp)
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
