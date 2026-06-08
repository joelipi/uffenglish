import React from 'react';
import { getBotIdentity } from '../../modules/user/bot-identity.js';

export default function StatsBubble({
    sectionKey,
    score,
    isPerfect,
    isOverall,
    attemptLabel,
    attemptCount,
    parts = [],
    botName,
    avatarUrl
}) {
    const botInfo = getBotIdentity(sectionKey);
    const displayBotName = botName || botInfo.name;
    const displayAvatar = avatarUrl || botInfo.avatar;

    const scoreDisplay = isPerfect ? '💯' : `${score}%`;
    const headerContent = isOverall ? <strong>{scoreDisplay} Fluency</strong> : <strong>{scoreDisplay}</strong>;

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={displayAvatar} alt={displayBotName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system" style={{ borderLeft: '4px solid #17a2b8' }}>
                <div className="chat-bubble-header">{displayBotName}</div>
                <div>
                    {headerContent}
                    {attemptLabel && attemptCount !== undefined && !(isPerfect && (sectionKey === 'pronunciation' || sectionKey === 'listening')) && ` · ${attemptLabel} ${attemptCount}`}
                </div>
                {parts.length > 0 && !(isPerfect && sectionKey === 'flow') && (
                    <div className="chat-message-content" style={{ marginTop: '5px' }}>
                        {/* Inline parts */}
                        {parts.some(p => p.display === 'inline') && (
                            <div>
                                {parts
                                    .filter(p => p.display === 'inline')
                                    .map((p, idx, arr) => (
                                        <span key={idx}>
                                            <strong>{p.label}:</strong> {p.value}
                                            {idx < arr.length - 1 ? ' · ' : ''}
                                        </span>
                                    ))
                                }
                            </div>
                        )}
                        {/* Block parts */}
                        {parts
                            .filter(p => p.display === 'block')
                            .map((p, idx) => {
                                if (p.type === 'idioms') {
                                    return (
                                        <div key={idx} style={{ marginTop: '5px' }}>
                                            <div>{p.count} idioms</div>
                                            {p.items && p.items.length > 0 && (
                                                <ul style={{ margin: '5px 0 0 15px', padding: 0 }}>
                                                    {p.items.map((item, itemIdx) => (
                                                        <li key={itemIdx}><em>{item}</em></li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                }
                                if (p.type === 'notice') {
                                    return (
                                        <div key={idx} className="limitation-notice" style={{ marginTop: '5px' }}>
                                            {p.message}
                                        </div>
                                    );
                                }
                                return (
                                    <div key={idx} style={{ marginTop: '5px' }}>
                                        {p.message || (
                                            <span>
                                                <strong>{p.label}:</strong> {p.value}
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        }
                    </div>
                )}
            </div>
        </div>
    );
}
