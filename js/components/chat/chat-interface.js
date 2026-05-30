import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';
import { getBotIdentity } from '../../modules/bot-identity.js';

export function showChat() {
    appStore.getState().setChatModeActive(true);
}

export function addAILoadingMessage(text) {
    const storeState = appStore.getState();
    showChat();
    let defaultText = 'Analyzing...';
    if (typeof Strings !== 'undefined' && typeof Strings.getBilingual === 'function') {
        const bilingual = Strings.getBilingual('ai_analyzing', storeState.userData?.native_language);
        defaultText = bilingual.english || defaultText;
    }
    storeState.addChatMessage({
        role: 'system',
        type: 'aiLoading',
        content: text || defaultText
    });
}

export function addAIFeedbackMessages(inputs = []) {
    if (inputs.length === 0) return;
    showChat();
    const store = appStore.getState();
    inputs.filter(Boolean).forEach(input => {
        const sectionKey = input.sectionKey || input.key;
        const botInfo = getBotIdentity(sectionKey);

        const msgObj = {
            ...input,
            role: input.role || 'system',
            type: input.type || 'standard',
            botName: input.botName || botInfo.name,
            avatarUrl: input.avatarUrl || botInfo.avatar,
        };
        store.addChatMessage(msgObj);
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
