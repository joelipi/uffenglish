import React from 'react';
import { computeGrammarDiff, isPunct } from '../../modules/diff-utils.js';
import { getBotIdentity } from '../../modules/bot-identity.js';

export default function GrammarDiffBubble({
    original,
    correction,
    score,
    errorCount,
    complexityScore,
    sectionKey,
    botName,
    avatarUrl
}) {
    const botInfo = getBotIdentity(sectionKey || 'grammar');
    const displayBotName = botName || botInfo.name;
    const displayAvatar = avatarUrl || botInfo.avatar;
    const tokens = computeGrammarDiff(original || "", correction || "");

    const scoreDisplay = score === 100 ? '💯' : `${score}%`;
    const errorText = errorCount !== undefined ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : '';
    const complexityText = complexityScore !== null && complexityScore !== undefined
        ? ` · ${complexityScore}% complexity` : '';

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={displayAvatar} alt={displayBotName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system" style={{ borderLeft: '4px solid #17a2b8' }}>
                <div className="chat-bubble-header">{displayBotName}</div>
                {score !== undefined && (
                    <div style={{ marginBottom: '8px' }}>
                        <strong>{scoreDisplay}</strong>
                        {errorText && ` · ${errorText}`}
                        {complexityText}
                    </div>
                )}
                {/* Deleted Row (Original with deletions highlighted) */}
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
                {/* Inserted Row (Correction with insertions highlighted) */}
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
            </div>
        </div>
    );
}
