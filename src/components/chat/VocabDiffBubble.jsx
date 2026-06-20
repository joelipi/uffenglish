import React from 'react';
import { computeGrammarDiff, isPunct } from '../../modules/utils/diff-utils.js';
import { getBotIdentity } from '../../modules/user/bot-identity.js';

export default function VocabDiffBubble({
    original,
    correction,
    score,
    errorCount,
    sectionKey,
    botName,
    avatarUrl
}) {
    const botInfo = getBotIdentity(sectionKey || 'vocabulary');
    // sectionKey is 'vocabulary' — matches BOT_IDENTITIES.vocabulary
    const displayBotName = botName || botInfo.name;
    const displayAvatar = avatarUrl || botInfo.avatar;
    const tokens = computeGrammarDiff(original || "", correction || "");

    const scoreDisplay = score === 100 ? '💯' : `${score}%`;
    const errorText = errorCount !== undefined ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : '';

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={displayAvatar} alt={displayBotName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system" style={{ borderLeft: '4px solid #6f42c1' }}>
                <div className="chat-bubble-header">{displayBotName}</div>
                {score !== undefined && (
                    <div>
                        <strong>{scoreDisplay}</strong>
                        {score !== 100 && errorText && ` · ${errorText}`}
                    </div>
                )}
                {score !== 100 && (
                    <>
                        <div className="diff-del-bubble">
                            {tokens
                                .filter(t => t.type === 'eq' || t.type === 'del')
                                .map((t, idx) => {
                                    if (t.type === 'del' && !isPunct(t.val)) {
                                        return <span key={idx} className="diff-del">{t.val}</span>;
                                    }
                                    return <span key={idx}>{t.val}</span>;
                                })
                            }
                        </div>
                        <div style={{ marginTop: '6px' }}>
                            {tokens
                                .filter(t => t.type === 'eq' || t.type === 'ins')
                                .map((t, idx) => {
                                    if (t.type === 'ins' && !isPunct(t.val)) {
                                        return <span key={idx} className="diff-ins">{t.val}</span>;
                                    }
                                    return <span key={idx}>{t.val}</span>;
                                })
                            }
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
