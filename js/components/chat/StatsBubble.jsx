import React from 'react';

export default function StatsBubble({ header, statsParts = [], botName = "Joe Walsh", avatarUrl = "assets/img/teacherprofile.webp" }) {
    const partsText = statsParts && statsParts.length > 0 ? ` ${statsParts.join('. ')}` : '';
    const fullContentHtml = `${header}${partsText}`;

    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={avatarUrl} alt={botName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system" style={{ borderLeft: '4px solid #17a2b8' }}>
                <div className="chat-bubble-header">{botName}</div>
                <span dangerouslySetInnerHTML={{ __html: fullContentHtml }} />
            </div>
        </div>
    );
}
