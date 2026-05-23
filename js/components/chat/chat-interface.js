import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';
import { DOM } from '../ui.js';

function setChatHeader(isAI) {
    if (DOM.avatarAi) DOM.avatarAi.classList.toggle('d-none', !isAI);
    if (DOM.nameAi) DOM.nameAi.classList.toggle('d-none', !isAI);
    if (DOM.avatarHuman) DOM.avatarHuman.classList.toggle('d-none', isAI);
    if (DOM.nameHuman) DOM.nameHuman.classList.toggle('d-none', isAI);
}

export function safeRenderChatInterface(isAI) {
    DOM.speechText.classList.remove('d-none');
    DOM.speechText.style.setProperty('display', 'flex', 'important');

    if (DOM.bottomOverlay) {
        DOM.bottomOverlay.style.setProperty('display', 'none', 'important');
    }

    document.body.classList.add('chat-mode-active');

    if (typeof setChatHeader === 'function') {
        setChatHeader(isAI);
    }
}

export function renderAIAnalysisLoading(text) {
    if (DOM.whisperReviewContainer) DOM.whisperReviewContainer.classList.add("d-none");
    const storeState = appStore.getState();

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
            const htmlContent = typeof chunk === 'string' ? chunk : chunk.outerHTML;

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'htmlChunk',
                content: htmlContent
            });
        }
    });
}

export function clearChatInterface() {
    if (DOM.whisperReviewContainer) DOM.whisperReviewContainer.classList.add("d-none");
    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
        document.body.appendChild(videoWrapper);
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
