import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MicrophoneToggle() {
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);
    const onMicClickCallback = useStore(appStore, (state) => state.onMicClickCallback);
    const micBounceTrigger = useStore(appStore, (state) => state.micBounceTrigger);
    const [bouncing, setBouncing] = useState(false);
    const ringRefs = useRef([null, null, null]);
    const micBtnRef = useRef(null);
    const animationRefs = useRef([]);

    useEffect(() => {
        if (isMicActive) {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });

            animationRefs.current = ringRefs.current.map((ring, index) => {
                if (!ring) return null;
                const anim = ring.animate([
                    { transform: 'scale(1)', opacity: 0.7 },
                    { transform: 'scale(2.6)', opacity: 0 }
                ], {
                    duration: 2000,
                    delay: [0, 650, 1300][index],
                    iterations: Infinity,
                    easing: 'ease-out'
                });
                return anim;
            }).filter(Boolean);
        } else {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });
            animationRefs.current = [];
        }

        return () => {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });
            animationRefs.current = [];
        };
    }, [isMicActive]);

    useEffect(() => {
        if (micBounceTrigger === 0) return;
        setBouncing(true);
        const timer = setTimeout(() => setBouncing(false), 1000);
        return () => clearTimeout(timer);
    }, [micBounceTrigger]);

    const handleClick = () => {
        if (typeof onMicClickCallback === 'function') {
            onMicClickCallback();
        } else if (typeof window.onMicClick === 'function') {
            window.onMicClick();
        } else {
            console.warn('[MicrophoneToggle] No mic click handler registered.');
        }
    };

    const handleTextClick = () => {
        const isTextInputVisible = appStore.getState().textInputVisible;

        if (isTextInputVisible) {
            appStore.getState().setTextInputVisible(false);
            appStore.getState().setMicActive(false);
            const player = appStore.getState().currentVideoPlayer;
            if (player && player.play) {
                player.play().catch(e => console.warn('[UI] Video resume failed:', e));
            }
        } else {
            appStore.getState().setTextInputVisible(true);
            appStore.getState().setMicActive(true);
            appStore.getState().triggerPauseAllVideos();
        }
    };

    const ringStyle = isMicActive ? { opacity: 0.7, pointerEvents: 'none' } : { opacity: 0, pointerEvents: 'none' };

    return (
        <div className={`mic-btn-wrapper${bottomControlState !== 'mic' ? ' d-none' : ''}`} id="state-standard-mic" style={{ display: 'flex' }}>
            <div ref={el => ringRefs.current[0] = el} className="mic-ring" style={ringStyle}></div>
            <div ref={el => ringRefs.current[1] = el} className="mic-ring" style={ringStyle}></div>
            <div ref={el => ringRefs.current[2] = el} className="mic-ring" style={ringStyle}></div>
            <button
                ref={micBtnRef}
                className={`btn call-btn ${isMicActive ? '' : 'toggled-off'} ${isTextMode ? 'd-none' : ''}${bouncing ? ' btn-bounce' : ''}`}
                id="micBtn"
                aria-label="Toggle Microphone"
                onClick={handleClick}
            >
                <i className={isMicActive ? "bi bi-mic-fill" : "bi bi-mic-mute-fill"}></i>
            </button>
            <button
                className={`btn call-btn ${isTextMode ? '' : 'd-none'}`}
                id="txtBtn"
                aria-label="Toggle Text Input"
                onClick={handleTextClick}
            >
                <i className="bi bi-keyboard-fill"></i>
            </button>
        </div>
    );
}
