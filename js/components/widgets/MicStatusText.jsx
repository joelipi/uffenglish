import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { pointLoss } from '../point-loss-animation.js';

export default function MicStatusText() {
    const micStatusText = useStore(appStore, (state) => state.micStatusText);
    const pointLossTrigger = useStore(appStore, (state) => state.pointLossTrigger);
    const pointLossData = useStore(appStore, (state) => state.pointLossData);

    const containerRef = useRef(null);
    const prevPointLossTrigger = useRef(pointLossTrigger);

    useEffect(() => {
        if (pointLossTrigger === prevPointLossTrigger.current || !pointLossData) return;
        prevPointLossTrigger.current = pointLossTrigger;
        if (pointLossData.target !== 'pronunciation' && containerRef.current) {
            pointLoss.show(containerRef.current, pointLossData.points);
        }
    }, [pointLossTrigger, pointLossData]);

    if (!micStatusText) return null;

    return (
        <div ref={containerRef} id="react-root-micstatus" className="d-flex justify-content-center align-items-center">
            <div id="micStatusText" dangerouslySetInnerHTML={{ __html: micStatusText }} />
        </div>
    );
}
