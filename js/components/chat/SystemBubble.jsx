import React from 'react';

export default function SystemBubble({ content, botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp" }) {
    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <span dangerouslySetInnerHTML={{ __html: content }} />
            </div>
        </div>
    );
}
