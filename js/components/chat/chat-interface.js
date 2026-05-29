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

export function addAIFeedbackMessages(inputs = []) {
    if (inputs.length === 0) return;
    showChat(true);
    inputs.filter(Boolean).forEach(input => {
        if (typeof input === 'string') {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'htmlChunk',
                content: input
            });
        } else if (input.type === 'praise') {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'praise',
                content: input.content,
                botName: input.botName || 'Joe Walsh',
                avatarUrl: input.avatarUrl || '/assets/img/teacherprofile.webp'
            });
        } else {
            appStore.getState().addChatMessage({
                role: 'system',
                type: input.type || 'htmlChunk',
                content: input.content
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
