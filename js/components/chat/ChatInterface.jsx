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

function PraiseWrapper({ msg }) {
    return (
        <div className="chat-message-row chat-message-row--system">
            <img src={msg.avatarUrl || "/assets/img/teacherprofile.webp"} alt={msg.botName || "Joe Walsh"} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system">
                <div className="chat-bubble-header">{msg.botName || "Joe Walsh"}</div>
                <PraiseBubble praiseData={msg.praiseData || msg.content} />
            </div>
        </div>
    );
}

function HtmlChunk({ msg }) {
    if (msg.content && msg.content.includes('chat-message-row')) {
        return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: msg.content }} />;
    }
    return <SystemBubble content={msg.content} botName={msg.botName} avatarUrl={msg.avatarUrl} />;
}

const SYSTEM_TYPE_COMPONENTS = {
    continueWidget: (msg) => <ContinueWidgetBubble key={msg.id} onClick={msg.onClick} />,
    grammarDiff: (msg) => <GrammarDiffBubble key={msg.id} original={msg.original} correction={msg.correction} botName={msg.botName} avatarUrl={msg.avatarUrl} />,
    stats: (msg) => <StatsBubble key={msg.id} header={msg.header} statsParts={msg.statsParts} botName={msg.botName} avatarUrl={msg.avatarUrl} />,
    pragmatics: (msg) => <PragmaticsBubble key={msg.id} contentHTML={msg.contentHTML || msg.content} correctionHTML={msg.correctionHTML} botName={msg.botName} avatarUrl={msg.avatarUrl} />,
    praise: (msg) => <PraiseWrapper key={msg.id} msg={msg} />,
    htmlChunk: (msg) => <HtmlChunk key={msg.id} msg={msg} />,
    aiLoading: (msg) => <AiLoadingBubble key={msg.id} text={msg.content} />,
    standard: (msg) => <SystemBubble key={msg.id} content={msg.content} botName={msg.botName} avatarUrl={msg.avatarUrl} />,
};

export default function ChatInterface() {
    const chatHistory = useStore(appStore, (state) => state.chatHistory);
    const containerRef = useRef(null);

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
                    const componentFn = SYSTEM_TYPE_COMPONENTS[msg.type] || SYSTEM_TYPE_COMPONENTS.standard;
                    return componentFn(msg);
                }

                return null;
            })}
        </div>
    );
}
