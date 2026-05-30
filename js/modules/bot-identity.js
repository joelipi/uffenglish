// Shared mapping of feedback sectionKey to Bot Name and Avatar URL.

export const BOT_IDENTITIES = {
    grammar: { name: 'Grammar', avatar: '/assets/img/grammarbot.webp' },
    vocabulary: { name: 'Vocabulary', avatar: '/assets/img/vocabularybot.webp' },
    flow: { name: 'Flow', avatar: '/assets/img/flowbot.webp' },
    pronunciation: { name: 'Pronunciation', avatar: '/assets/img/pronunciationbot.webp' },
    listening: { name: 'Listening', avatar: '/assets/img/listeningbot.webp' },
    formality: { name: 'Formality', avatar: '/assets/img/formalitybot.webp' },
    nativeLike: { name: 'Smoothness', avatar: '/assets/img/smoothnessbot.webp' },
    understanding: { name: 'Understanding', avatar: '/assets/img/understandingbot.webp' },
    fluency: { name: 'Joe Walsh', avatar: '/assets/img/teacherprofile.webp' }
};

export const DEFAULT_BOT_IDENTITY = { name: 'FluIntel AI', avatar: '/assets/img/ai.webp' };

export function getBotIdentity(key) {
    return BOT_IDENTITIES[key] || DEFAULT_BOT_IDENTITY;
}
