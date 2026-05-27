import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export default function PointLossOverlay() {
    const amount = useStore(appStore, (state) => state.pointLossAmount);

    useEffect(() => {
        if (amount === null) return;
        const timer = setTimeout(() => {
            appStore.getState().setPointLossAmount(null);
        }, 1500);
        return () => clearTimeout(timer);
    }, [amount]);

    if (amount === null) return null;

    return (
        <div className="point-loss-float animate">-{amount}</div>
    );
}
