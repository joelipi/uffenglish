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
import TeacherFeedbackBubble from './TeacherFeedbackBubble.jsx';
import PossibleAnswerBubble from './PossibleAnswerBubble.jsx';

const SYSTEM_TYPE_COMPONENTS = {
    continueWidget: (msg) => <ContinueWidgetBubble key={msg.id} onClick={msg.onClick} />,
    grammarDiff: (msg) => (
        <GrammarDiffBubble
            key={msg.id}
            original={msg.original}
            correction={msg.correction}
            score={msg.score}
            errorCount={msg.errorCount}
            complexityScore={msg.complexityScore}
            sectionKey={msg.sectionKey}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    stat: (msg) => (
        <StatsBubble
            key={msg.id}
            sectionKey={msg.sectionKey}
            score={msg.score}
            isPerfect={msg.isPerfect}
            isOverall={msg.isOverall}
            attemptLabel={msg.attemptLabel}
            attemptCount={msg.attemptCount}
            parts={msg.parts}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    pragmatics: (msg) => (
        <PragmaticsBubble
            key={msg.id}
            header={msg.header}
            correction={msg.correction}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    praise: (msg) => (
        <PraiseBubble
            key={msg.id}
            praiseData={msg.praiseData || msg.content}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    teacherFeedback: (msg) => (
        <TeacherFeedbackBubble
            key={msg.id}
            content={msg.content}
            translation={msg.translation}
            translationLang={msg.translationLang}
            correctWords={msg.correctWords}
            incorrectWords={msg.incorrectWords}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    possibleAnswer: (msg) => (
        <PossibleAnswerBubble
            key={msg.id}
            label={msg.label}
            answer={msg.answer}
            translation={msg.translation}
            translationLang={msg.translationLang}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    aiLoading: (msg) => <AiLoadingBubble key={msg.id} text={msg.content} />,
    standard: (msg) => (
        <SystemBubble
            key={msg.id}
            content={msg.content}
            translation={msg.translation}
            translationLang={msg.translationLang}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
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
            style={{ overflowY: 'auto' }}
        >
            {chatHistory.map((msg, index) => {
                const key = msg.id || index;

                if (msg.role === 'user') {
                    if (msg.type === 'video') {
                        return <VideoBubble key={key} avatarUrl={msg.userAvatarUrl} userName={msg.userName} />;
                    }
                    return (
                        <UserBubble
                            key={key}
                            text={msg.content}
                            translation={msg.translation}
                            translationLang={msg.translationLang}
                            userName={msg.userName}
                            userAvatarUrl={msg.userAvatarUrl}
                        />
                    );
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
