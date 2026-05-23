import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';

export function safeRenderChatInterface(isAI) {
    const chatWindow = document.getElementById('chat-window-container');
    if (chatWindow) {
        chatWindow.classList.remove('d-none');
        chatWindow.style.setProperty('display', 'flex', 'important');
    }

    const bottomOverlay = document.querySelector('.bottom-overlay');
    if (bottomOverlay) {
        bottomOverlay.style.setProperty('display', 'none', 'important');
    }

    document.body.classList.add('chat-mode-active');

    appStore.getState().setChatModeActive(true);
    appStore.getState().setChatHeaderMode(isAI ? 'ai' : 'human');
}

export function renderAIAnalysisLoading(text) {
    const whisperEl = document.getElementById('whisperReviewContainer');
    if (whisperEl) whisperEl.classList.add("d-none");
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
    const whisperEl = document.getElementById('whisperReviewContainer');
    if (whisperEl) whisperEl.classList.add("d-none");
    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
        document.body.appendChild(videoWrapper);
    }

    appStore.getState().clearChatHistory();

    const chatWindow = document.getElementById('chat-window-container');
    if (chatWindow) {
        chatWindow.classList.add('d-none');
        chatWindow.style.removeProperty('display');
    }

    const bottomOverlay = document.querySelector('.bottom-overlay');
    if (bottomOverlay) {
        bottomOverlay.style.removeProperty('display');
    }

    document.body.classList.remove('chat-mode-active');

    appStore.getState().setTutorChatVisible(false);
    appStore.getState().setTextInputVisible(false);
    appStore.getState().setChatModeActive(false);
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
    const history = appStore.getState().chatHistory;
    let historyText = "";
    for (const msg of history) {
        if (msg.type === 'aiLoading') continue;
        const role = msg.role === 'user' ? "Student" : "Tutor";
        const content = typeof msg.content === 'string' ? msg.content : '';
        historyText += `${role}: ${content}\n`;
    }
    return historyText;
}
