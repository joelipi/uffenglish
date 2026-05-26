import React from 'react';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/tutor-config.js';

export default function PragmaticsBubble({ contentHTML, correctionHTML = "", botName = DEFAULT_BOT_NAME, avatarUrl = DEFAULT_AVATAR_URL }) {
    const fullHtml = `${contentHTML}${correctionHTML ? ` ${correctionHTML}` : ''}`;

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <span dangerouslySetInnerHTML={{ __html: fullHtml }} />
            </div>
        </div>
    );
}
