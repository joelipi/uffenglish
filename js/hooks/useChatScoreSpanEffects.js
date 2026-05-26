import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

const SCORE_SPAN_MAP = {
    pronunciationScore: 'chat-score-pronunciation',
    listeningScore: 'chat-score-listening',
    flowScore: 'chat-score-flow',
    vocabularyScore: 'chat-score-vocabulary',
    grammarScore: 'chat-score-grammar',
    formalityScore: 'chat-score-formality',
    nativeLikeScore: 'chat-score-nativelike',
    understandingScore: 'chat-score-understanding',
    fluencyScore: 'chat-score-fluency',
};

export function useChatScoreSpanEffects() {
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const prevScoreValues = useRef({});

    useEffect(() => {
        if (!chatModeActive) return;

        Object.entries(SCORE_SPAN_MAP).forEach(([storeKey, spanId]) => {
            const score = appStore.getState()[storeKey];
            if (score !== undefined && score !== prevScoreValues.current[storeKey]) {
                prevScoreValues.current[storeKey] = score;
                const el = document.getElementById(spanId);
                if (el) el.textContent = score === 100 ? '\uD83D\uDC4D' : String(Math.round(score));
            }
        });
    }, [chatModeActive]);
}
