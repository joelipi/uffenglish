import React from 'react';
import { DEFAULT_USER_NAME, DEFAULT_USER_AVATAR_URL } from '../../modules/user/tutor-config.js';

export default function UserBubble({ text, translation, translationLang, userName, userAvatarUrl }) {
    return (
        <div className="chat-message-row chat-message-row--user">
            <img src={userAvatarUrl || DEFAULT_USER_AVATAR_URL} alt={userName || DEFAULT_USER_NAME} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--user">
                <div className="chat-bubble-header">{userName || DEFAULT_USER_NAME}</div>
                <div className="chat-message-content">
                    {text}
                    {translation && translationLang && (
                        <span lang={translationLang}>
                            {' '}
                            <i>{translation}</i>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
