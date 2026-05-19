import React from 'react';
import { appStore } from '../../modules/store.js';

export default function UserBubble({ text, userName, userAvatarUrl }) {
    const defaultUserName = userName || appStore.getState().userData?.display_name?.split(' ')[0] || 'You';
    const defaultAvatarUrl = userAvatarUrl || appStore.getState().userData?.profilepicurl || 'assets/img/userprofile.webp';

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
