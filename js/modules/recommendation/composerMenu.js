export const CHANNELS = [
    { handle: '@grammar', label: 'Grammar check', inputMode: 'template', ai: false, notes: 'Routes to NLP worker via postMessage; stub if worker not ready' },
    { handle: '@vocabulary', label: 'Vocabulary help', inputMode: 'quickreplies', ai: false, notes: 'Lesson context only' },
    { handle: '@aitutor', label: 'Ask the AI tutor', inputMode: 'suggested + freetext', ai: true, notes: 'Cached questions from manifest' },
    { handle: '@support', label: 'Support', inputMode: 'freetext', ai: false, notes: 'Stub — open-source ticketing system TBD' }
];

export function isAvailable(channelHandle, context) {
    const { screen, lessonState, chatMode } = context;

    if (channelHandle === '@support') {
        return true;
    }

    if (chatMode === 'answer') {
        return false;
    }

    if (lessonState === 'question_active') {
        return false;
    }

    if (channelHandle === '@grammar' || channelHandle === '@aitutor') {
        return true; // available in home, question_answered, between_questions
    }

    if (channelHandle === '@vocabulary') {
        if (screen === 'home') return false;
        return true; // available in question_answered, between_questions
    }

    return false;
}

export function getAvailableChannels(context) {
    return CHANNELS.filter(channel => isAvailable(channel.handle, context));
}

export async function handleGrammarChannel(userInput, askWorker) {
    if (typeof askWorker !== 'function') {
        return null; // Worker not ready
    }
    try {
        return await askWorker('CHECK_GRAMMAR', { userInput });
    } catch (err) {
        console.warn('[Grammar] Worker error:', err);
        return null;
    }
}
