import grammarAvatar from '../../assets/img/grammarbot.webp';
import vocabularyAvatar from '../../assets/img/vocabularybot.webp';
import flowAvatar from '../../assets/img/flowbot.webp';
import pronunciationAvatar from '../../assets/img/pronunciationbot.webp';
import listeningAvatar from '../../assets/img/listeningbot.webp';
import formalityAvatar from '../../assets/img/formalitybot.webp';
import smoothnessAvatar from '../../assets/img/smoothnessbot.webp';
import understandingAvatar from '../../assets/img/understandingbot.webp';
import teacherAvatar from '../../assets/img/teacherprofile.webp';
import aiAvatar from '../../assets/img/ai.webp';

export const BOT_IDENTITIES = {
    grammar: { name: 'Grammar', avatar: grammarAvatar },
    vocabulary: { name: 'Vocabulary', avatar: vocabularyAvatar },
    flow: { name: 'Flow', avatar: flowAvatar },
    pronunciation: { name: 'Pronunciation', avatar: pronunciationAvatar },
    listening: { name: 'Listening', avatar: listeningAvatar },
    formality: { name: 'Formality', avatar: formalityAvatar },
    nativeLike: { name: 'Smoothness', avatar: smoothnessAvatar },
    understanding: { name: 'Understanding', avatar: understandingAvatar },
    fluency: { name: 'Joe Walsh', avatar: teacherAvatar }
};

export const DEFAULT_BOT_IDENTITY = { name: 'FluIntel AI', avatar: aiAvatar };

export function getBotIdentity(key) {
    return BOT_IDENTITIES[key] || DEFAULT_BOT_IDENTITY;
}
