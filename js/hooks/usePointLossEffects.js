import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { pointLoss } from '../components/point-loss-animation.js';

export function usePointLossEffects() {
    const pointLossTrigger = useStore(appStore, (state) => state.pointLossTrigger);
    const pointLossData = useStore(appStore, (state) => state.pointLossData);
    const preflightRejectedTrigger = useStore(appStore, (state) => state.preflightRejectedTrigger);
    const transcriptRejectedTrigger = useStore(appStore, (state) => state.transcriptRejectedTrigger);
    const prevPointLossTrigger = useRef(pointLossTrigger);
    const prevPreflightTrigger = useRef(preflightRejectedTrigger);
    const prevTranscriptTrigger = useRef(transcriptRejectedTrigger);

    useEffect(() => {
        if (pointLossTrigger === prevPointLossTrigger.current || !pointLossData) return;
        prevPointLossTrigger.current = pointLossTrigger;

        const targetEl = document.getElementById(
            pointLossData.target === 'pronunciation' ? 'pronunciationScore' : 'react-root-micstatus'
        );
        if (targetEl) {
            pointLoss.show(targetEl, pointLossData.points);
        }
        appStore.getState().clearPointLoss();
    }, [pointLossTrigger, pointLossData]);

    useEffect(() => {
        if (preflightRejectedTrigger === prevPreflightTrigger.current) return;
        prevPreflightTrigger.current = preflightRejectedTrigger;

        const targetEl = document.getElementById('pronunciationScore');
        if (targetEl) {
            pointLoss.show(targetEl, 10);
        }
    }, [preflightRejectedTrigger]);

    useEffect(() => {
        if (transcriptRejectedTrigger === prevTranscriptTrigger.current) return;
        prevTranscriptTrigger.current = transcriptRejectedTrigger;

        const targetEl = document.getElementById('pronunciationScore');
        if (targetEl) {
            pointLoss.show(targetEl, 20);
        }
    }, [transcriptRejectedTrigger]);
}
