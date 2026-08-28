import React, { useState, useEffect } from 'react';
import { DEFAULT_USER_NAME, DEFAULT_USER_AVATAR_URL } from '../../modules/user/tutor-config.js';
import { getAvatarBlobUrl } from '../../modules/avatar/avatar.service.js';

export default function UserBubble({ text, translation, translationLang, userName, userAvatarUrl, reactionCount }) {
    const [resolvedUrl, setResolvedUrl] = useState(null);

    useEffect(() => { setResolvedUrl(null); }, [userAvatarUrl]);

    const src = resolvedUrl || userAvatarUrl || DEFAULT_USER_AVATAR_URL;

    return (
        <div className="chat-message-row chat-message-row--user">
            <img src={src} alt={userName || DEFAULT_USER_NAME} className="chat-avatar-inline" onError={e => { e.currentTarget.src = DEFAULT_USER_AVATAR_URL; }} />
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
            {reactionCount > 0 && <div id="bot-reaction">💯{reactionCount}</div>}
        </div>
    );
}
