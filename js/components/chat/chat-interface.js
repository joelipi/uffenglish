import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';

export function showChat(isAI) {
    appStore.getState().setChatModeActive(true);
    appStore.getState().setChatHeaderMode(isAI ? 'ai' : 'human');
}

export function addAILoadingMessage(text) {
    const storeState = appStore.getState();
    showChat(true);
    let defaultText = 'Analyzing...';
    if (typeof Strings !== 'undefined' && typeof Strings.get === 'function') {
        defaultText = Strings.get('ai_analyzing', storeState.userData?.native_language) || defaultText;
    }
    storeState.addChatMessage({
        role: 'system',
        type: 'aiLoading',
        content: text || defaultText
    });
}

export function addAIFeedbackMessages(contentChunks = []) {
    if (contentChunks.length === 0) return;
    showChat(true);
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

export function clearChat() {
    appStore.getState().clearChatHistory();
    appStore.getState().setTutorChatVisible(false);
    appStore.getState().setTextInputVisible(false);
    appStore.getState().setChatModeActive(false);
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
