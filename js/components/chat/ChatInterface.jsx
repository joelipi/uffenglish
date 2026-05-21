import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import UserBubble from './UserBubble.jsx';
import SystemBubble from './SystemBubble.jsx';
import GrammarDiffBubble from './GrammarDiffBubble.jsx';
import PragmaticsBubble from './PragmaticsBubble.jsx';
import PraiseBubble from './PraiseBubble.jsx';
import StatsBubble from './StatsBubble.jsx';
import AiLoadingBubble from './AiLoadingBubble.jsx';
import VideoBubble from './VideoBubble.jsx';
import ContinueWidgetBubble from './ContinueWidgetBubble.jsx';

export default function ChatInterface() {
    const chatHistory = useStore(appStore, (state) => state.chatHistory);
    const containerRef = useRef(null);

    // Auto-scroll to bottom whenever chat history changes
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    return (
        <div
            id="chat-message-list"
            ref={containerRef}
            className="card-body chat-message-list text-dark"
        >
            {chatHistory.map((msg, index) => {
                const key = msg.id || index;

                if (msg.role === 'user') {
                    if (msg.type === 'video') {
                        return <VideoBubble key={key} avatarUrl={msg.userAvatarUrl} userName={msg.userName} />;
                    }
                    return <UserBubble key={key} text={msg.content} userName={msg.userName} userAvatarUrl={msg.userAvatarUrl} />;
                }

                if (msg.role === 'system') {
                    switch (msg.type) {
                        case 'continueWidget':
                            return <ContinueWidgetBubble key={key} onClick={msg.onClick} />;
                        case 'grammarDiff':
                            return <GrammarDiffBubble key={key} original={msg.original} correction={msg.correction} botName={msg.botName} avatarUrl={msg.avatarUrl} />;
                        case 'stats':
                            return <StatsBubble key={key} header={msg.header} statsParts={msg.statsParts} botName={msg.botName} avatarUrl={msg.avatarUrl} />;
                        case 'pragmatics':
                            return <PragmaticsBubble key={key} contentHTML={msg.contentHTML || msg.content} correctionHTML={msg.correctionHTML} botName={msg.botName} avatarUrl={msg.avatarUrl} />;
                        case 'praise':
                            return (
                                <div key={key} className="chat-message-row chat-message-row--system">
                                    <img src={msg.avatarUrl || "/assets/img/teacherprofile.webp"} alt={msg.botName || "Joe Walsh"} className="chat-avatar-inline" />
                                    <div className="chat-message-bubble chat-message-bubble--system">
                                        <div className="chat-bubble-header">{msg.botName || "Joe Walsh"}</div>
                                        <PraiseBubble praiseData={msg.praiseData || msg.content} />
                                    </div>
                                </div>
                            );
                        case 'htmlChunk':
                            // SMART ROUTER FIX:
                            // If it's a fully formed vanilla DOM widget, render it as-is so it fits the CSS flexbox.
                            if (msg.content && msg.content.includes('chat-message-row')) {
                                return <div key={key} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: msg.content }} />;
                            }
                            // If it's just naked text (e.g. "👍👍 Very good!"), wrap it in a proper SystemBubble!
                            return <SystemBubble key={key} content={msg.content} botName={msg.botName} avatarUrl={msg.avatarUrl} />;

                        case 'aiLoading':
                            return <AiLoadingBubble key={key} text={msg.content} />;
                        case 'standard':
                        default:
                            return <SystemBubble key={key} content={msg.content} botName={msg.botName} avatarUrl={msg.avatarUrl} />;
                    }
                }
                return null;
            })}
        </div>
    );
}