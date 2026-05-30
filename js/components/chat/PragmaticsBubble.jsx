import React from 'react';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/tutor-config.js';

export default function PragmaticsBubble({ header, correction = "", botName = DEFAULT_BOT_NAME, avatarUrl = DEFAULT_AVATAR_URL }) {
    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system" style={{ borderLeft: '4px solid #ffc107' }}>
                <div className="chat-bubble-header">{botName}</div>
                <div style={{ fontSize: '0.85em', textTransform: 'uppercase', color: '#17a2b8', marginBottom: '5px' }}>
                    <strong>{header}</strong>
                </div>
                {correction && (
                    <div className="chat-message-correction">
                        {correction}
                    </div>
                )}
            </div>
        </div>
    );
}
