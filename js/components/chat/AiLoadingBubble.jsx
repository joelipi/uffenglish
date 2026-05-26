import React from 'react';
import { DEFAULT_AI_NAME, DEFAULT_AI_AVATAR_URL } from '../../modules/tutor-config.js';

export default function AiLoadingBubble({ text }) {
    const displayText = text || 'Analyzing audio...';

    return (
        <div className="chat-message-row chat-message-row--system" id="ai-loading-status">
            <img src={DEFAULT_AI_AVATAR_URL} alt={DEFAULT_AI_NAME} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{DEFAULT_AI_NAME}</div>
                <strong>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    {' '}<span dangerouslySetInnerHTML={{ __html: displayText }} />
                </strong>
            </div>
        </div>
    );
}
