// --- modules/ui.js ---
import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { Media } from '../modules/media.js';

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
    get tutorChatInputArea() { return document.getElementById('chat-input-area'); },
    get micBtn() { return document.getElementById('micBtn'); },
    get txtBtn() { return document.getElementById('txtBtn'); },
    get answerInputArea() { return document.getElementById('answer-input-area'); },
    get answerInputField() { return document.getElementById('answer-input-field'); },
    get answerSubmitBtn() { return document.getElementById('answer-submit-button'); },
    get answerErrorMsg() { return document.getElementById('answer-error-message'); },
};

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
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    const tokenize = str => str.trim().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?|[^\p{L}\p{N}\s]+|\s+/gu) || [];
    const tokA = tokenize(userResponse || ""), tokB = tokenize(cueText || "");
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