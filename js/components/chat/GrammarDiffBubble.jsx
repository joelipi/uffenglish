import React from 'react';
import { renderGrammarDiffHTML } from '../../modules/diff-utils.js';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/tutor-config.js';

export default function GrammarDiffBubble({ original, correction, botName = DEFAULT_BOT_NAME, avatarUrl = DEFAULT_AVATAR_URL }) {
    const { userHTML, corrHTML } = renderGrammarDiffHTML(original || "", correction || "");

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{botName}</div>
                <div className="diff-del-bubble" dangerouslySetInnerHTML={{ __html: userHTML }} />
                <div style={{ marginTop: '6px' }} dangerouslySetInnerHTML={{ __html: corrHTML }} />
            </div>
        </div>
    );
}
