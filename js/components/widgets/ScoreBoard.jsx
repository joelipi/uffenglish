import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function ScoreBoard() {
    const listeningScore = useStore(appStore, (state) => state.listeningScore);
    const speakingScore = useStore(appStore, (state) => state.speakingScore);
    const flowScore = useStore(appStore, (state) => state.flowScore);

    return (
        <div id="stats-container" className="row w-100 mx-0 mt-0 text-white stats-container">
            {/* Pronunciation (left) */}
            <div className="col-4 d-flex align-items-center justify-content-center px-2">
                <div title="Pronunciation" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">PRONUNCIATION</div>
                    <span id="pronunciationScore" className="bot-score">{speakingScore}</span>
                </div>
            </div>
            {/* Listening (centered) */}
            <div className="col-4 d-flex align-items-center justify-content-center px-2">
                <div title="Listening" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">LISTENING</div>
                    <span id="listeningScore" className="bot-score">{listeningScore}</span>
                </div>
            </div>
            {/* Flow (right) */}
            <div className="col-4 d-flex align-items-center justify-content-center px-2">
                <div title="Flow" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">SPEAKING FLOW</div>
                    <span id="flowScore" className="bot-score">{flowScore}</span>
                </div>
            </div>
        </div>
    );
}
