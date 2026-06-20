import React, { useEffect, useRef, useMemo } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import UserBubble from './UserBubble.jsx';
import SystemBubble from './SystemBubble.jsx';
import GrammarDiffBubble from './GrammarDiffBubble.jsx';
import VocabDiffBubble from './VocabDiffBubble.jsx';
import PragmaticsBubble from './PragmaticsBubble.jsx';
import PraiseBubble from './PraiseBubble.jsx';
import StatsBubble from './StatsBubble.jsx';
import AiLoadingBubble from './AiLoadingBubble.jsx';
import VideoBubble from './VideoBubble.jsx';
import ContinueWidgetBubble from './ContinueWidgetBubble.jsx';
import TeacherFeedbackBubble from './TeacherFeedbackBubble.jsx';
import PossibleAnswerBubble from './PossibleAnswerBubble.jsx';

const SYSTEM_TYPE_COMPONENTS = {
    continueWidget: (msg) => <ContinueWidgetBubble key={msg.id} onClick={msg.onClick} nextStepVideoUrl={msg.nextStepVideoUrl} />,
    grammarDiff: (msg) => (
        <GrammarDiffBubble
            key={msg.id}
            original={msg.original}
            correction={msg.correction}
            score={msg.score}
            errorCount={msg.errorCount}
            sectionKey={msg.sectionKey}
            botName={msg.botName}
            avatarUrl={msg.avatarUrl}
        />
    ),
    vocabDiff: (msg) => (
        <VocabDiffBubble
            key={msg.id}
            original={msg.original}
            correction={msg.correction}
            score={msg.score}
            errorCount={msg.errorCount}
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

    const perfectCount = useMemo(() => {
        return chatHistory.filter(msg => (msg.type === 'stat' || msg.type === 'grammarDiff') && msg.isPerfect).length;
    }, [chatHistory]);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTo({
                top: containerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [chatHistory]);

    const firstUserMsg = useMemo(() => chatHistory.find(msg => msg.role === 'user'), [chatHistory]);

    const sortedHistory = useMemo(() => {
        const result = [];
        let preStat = [];
        let pendingPerfect = [];
        let pendingNonPerfect = [];
        let hasSeenStat = false;
        for (const msg of chatHistory) {
            if (msg.role === 'user') {
                result.push(...preStat);
                result.push(...pendingPerfect);
                result.push(...pendingNonPerfect);
                preStat = [];
                pendingPerfect = [];
                pendingNonPerfect = [];
                hasSeenStat = false;
                result.push(msg);
            } else if ((msg.type === 'stat' || msg.type === 'grammarDiff')) {
                hasSeenStat = true;
                if (msg.isPerfect) {
                    pendingPerfect.push(msg);
                } else {
                    pendingNonPerfect.push(msg);
                }
            } else if (hasSeenStat) {
                result.push(...pendingPerfect);
                result.push(...pendingNonPerfect);
                pendingPerfect = [];
                pendingNonPerfect = [];
                result.push(msg);
            } else {
                preStat.push(msg);
            }
        }
        result.push(...preStat);
        result.push(...pendingPerfect);
        result.push(...pendingNonPerfect);
        return result;
    }, [chatHistory]);

    return (
        <div
            id="chat-message-list"
            ref={containerRef}
            className="card-body chat-message-list text-dark"
            style={{ overflowY: 'auto', position: 'relative' }}
        >
            {sortedHistory.map((msg) => {
                const key = msg.id;
                if (msg.role === 'user') {
                    const isFirstUser = msg === firstUserMsg;
                    let bubble;
                    if (msg.type === 'video') {
                        bubble = <VideoBubble avatarUrl={msg.userAvatarUrl} userName={msg.userName} reactionCount={isFirstUser ? perfectCount : 0} />;
                    } else {
                        bubble = (
                            <UserBubble
                                text={msg.content}
                                translation={msg.translation}
                                translationLang={msg.translationLang}
                                userName={msg.userName}
                                userAvatarUrl={msg.userAvatarUrl}
                                reactionCount={isFirstUser ? perfectCount : 0}
                            />
                        );
                    }
                    return (
                        <div key={key} className="chat-message-row-wrapper">
                            {bubble}
                        </div>
                    );
                }

                if (msg.role === 'system') {
                    const componentFn = SYSTEM_TYPE_COMPONENTS[msg.type] || SYSTEM_TYPE_COMPONENTS.standard;
                    return (
                        <div key={key} className="chat-message-row-wrapper">
                            {componentFn(msg)}
                        </div>
                    );
                }

                return null;
            })}
        </div>
    );
}
