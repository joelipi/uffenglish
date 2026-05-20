import React from 'react';

export default function UserBubble({ text, userName, userAvatarUrl }) {
    const defaultUserName = userName || 'You';
    const defaultAvatarUrl = userAvatarUrl || 'assets/img/userprofile.webp';

    return (
        <div className="chat-message-row chat-message-row--user">
            <img src={defaultAvatarUrl} alt={defaultUserName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--user">
                <div className="chat-bubble-header">{defaultUserName}</div>
                {text}
            </div>
        </div>
    );
}