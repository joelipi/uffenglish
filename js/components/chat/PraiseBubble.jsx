import React from 'react';

export default function PraiseBubble({ praiseData, botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp" }) {
    if (!praiseData || praiseData.type !== 'image') return null;

    return (
        <div className="chat-message-row chat-message-row--system" style={{ marginTop: '6px' }}>
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <img
                    src={praiseData.content}
                    className="img-fluid rounded praise-image"
                    alt="Praise"
                    style={{ maxHeight: '200px', display: 'block', margin: '10px auto' }}
                />
            </div>
        </div>
    );
}
