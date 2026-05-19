import React from 'react';

export default function AiLoadingBubble({ text }) {
    const defaultText = text || 'Analyzing audio...';
    const aiAvatarUrl = 'assets/img/ai.webp';
    const aiTutorName = 'FluIntel AI';

    return (
        <div className="chat-message-row chat-message-row--system" id="ai-loading-status">
            <img src={aiAvatarUrl} alt={aiTutorName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{aiTutorName}</div>
                <strong>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    {' '}{defaultText}
                </strong>
            </div>
        </div>
    );
}
