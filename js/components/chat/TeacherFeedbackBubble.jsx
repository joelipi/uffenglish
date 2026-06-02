import React from 'react';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/user/tutor-config.js';

export default function TeacherFeedbackBubble({
    content,
    translation,
    translationLang,
    correctWords = [],
    incorrectWords = [],
    botName = DEFAULT_BOT_NAME,
    avatarUrl = DEFAULT_AVATAR_URL
}) {
    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <div className="chat-message-content">
                    <strong>{content}</strong>
                    {translation && translationLang && (
                        <div lang={translationLang} style={{ marginTop: '4px' }}>
                            <i>{translation}</i>
                        </div>
                    )}
                    {correctWords.length > 0 && (
                        <ul className="card-text correctWords list-inline" style={{ display: 'block', marginTop: '10px' }}>
                            {correctWords.map((word, idx) => (
                                <li key={idx} className="list-inline-item" style={{ marginRight: '8px' }}>{word}</li>
                            ))}
                        </ul>
                    )}
                    {incorrectWords.length > 0 && (
                        <ul className="card-text incorrectWords list-inline" style={{ display: 'block', borderTop: '1px solid rgba(0, 0, 0, 0.1)', marginTop: '5px', paddingTop: '5px' }}>
                            {incorrectWords.map((word, idx) => (
                                <li key={idx} className="list-inline-item" style={{ marginRight: '8px' }}>{word}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
