import React from 'react';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/user/tutor-config.js';

export default function PossibleAnswerBubble({
    label,
    answer,
    translation,
    translationLang,
    botName = DEFAULT_BOT_NAME,
    avatarUrl = DEFAULT_AVATAR_URL
}) {
    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" onError={e => { e.currentTarget.src = DEFAULT_AVATAR_URL; }} />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <div className="chat-message-content">
                    <div>{label}</div>
                    <div style={{ marginTop: '4px' }}>
                        <strong>{answer}</strong>
                    </div>
                    {translation && translationLang && (
                        <div lang={translationLang} style={{ marginTop: '4px' }}>
                            <i>{translation}</i>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
