import React from 'react';

export default function PragmaticsBubble({ contentHTML, correctionHTML = "", botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp" }) {
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
