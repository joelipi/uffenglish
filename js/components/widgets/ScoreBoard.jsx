import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { pointLoss } from '../point-loss-animation.js';

export default function ScoreBoard() {
    const listeningScore = useStore(appStore, (state) => state.listeningScore);
    const speakingScore = useStore(appStore, (state) => state.speakingScore);
    const flowScore = useStore(appStore, (state) => state.flowScore);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const pointLossTrigger = useStore(appStore, (state) => state.pointLossTrigger);
    const pointLossData = useStore(appStore, (state) => state.pointLossData);
    const preflightRejectedTrigger = useStore(appStore, (state) => state.preflightRejectedTrigger);
    const transcriptRejectedTrigger = useStore(appStore, (state) => state.transcriptRejectedTrigger);

    const pronunciationRef = useRef(null);
    const flowRef = useRef(null);
    const prevPointLossTrigger = useRef(pointLossTrigger);
    const prevPreflightTrigger = useRef(preflightRejectedTrigger);
    const prevTranscriptTrigger = useRef(transcriptRejectedTrigger);

    useEffect(() => {
        if (pointLossTrigger === prevPointLossTrigger.current || !pointLossData) return;
        prevPointLossTrigger.current = pointLossTrigger;
        if (pointLossData.target === 'pronunciation' && pronunciationRef.current) {
            pointLoss.show(pronunciationRef.current, pointLossData.points);
        }
        if (pointLossData.target === 'flow' && flowRef.current) {
            pointLoss.show(flowRef.current, pointLossData.points);
        }
        appStore.getState().clearPointLoss();
    }, [pointLossTrigger, pointLossData]);

    useEffect(() => {
        if (preflightRejectedTrigger === prevPreflightTrigger.current) return;
        prevPreflightTrigger.current = preflightRejectedTrigger;
        if (pronunciationRef.current) {
            pointLoss.show(pronunciationRef.current, 10);
        }
    }, [preflightRejectedTrigger]);

    useEffect(() => {
        if (transcriptRejectedTrigger === prevTranscriptTrigger.current) return;
        prevTranscriptTrigger.current = transcriptRejectedTrigger;
        if (pronunciationRef.current) {
            pointLoss.show(pronunciationRef.current, 20);
        }
    }, [transcriptRejectedTrigger]);

    return (
        <div id="stats-container" className="row w-100 mx-0 mt-0 text-white stats-container">
            <div className={`col-4 d-flex align-items-center justify-content-center px-2${isTextMode ? ' invisible' : ''}`}>
                <div title="Pronunciation" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">PRONUNCIATION</div>
                    <span ref={pronunciationRef} id="pronunciationScore" className="bot-score">{speakingScore}</span>
                </div>
            </div>
            <div className="col-4 d-flex align-items-center justify-content-center px-2">
                <div title="Listening" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">LISTENING</div>
                    <span id="listeningScore" className="bot-score">{listeningScore}</span>
                </div>
            </div>
            <div className={`col-4 d-flex align-items-center justify-content-center px-2${isTextMode ? ' invisible' : ''}`}>
                <div title="Flow" className="d-flex flex-column align-items-center w-100">
                    <div className="chat-bubble-header stats-header-label">SPEAKING FLOW</div>
                    <span ref={flowRef} id="flowScore" className="bot-score">{flowScore}</span>
                </div>
            </div>
        </div>
    );
}
