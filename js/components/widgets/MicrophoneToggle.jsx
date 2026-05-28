import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MicrophoneToggle() {
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);
    const onMicClickCallback = useStore(appStore, (state) => state.onMicClickCallback);
    const currentVideoPlayer = useStore(appStore, (state) => state.currentVideoPlayer);
    const micBounceTrigger = useStore(appStore, (state) => state.micBounceTrigger);
    const containerRef = useRef(null);
    const micBtnRef = useRef(null);
    const animationRefs = useRef([]);

    useEffect(() => {
        if (!containerRef.current) return;
        const rings = containerRef.current.querySelectorAll('.mic-ring');

        if (isMicActive) {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });

            animationRefs.current = Array.from(rings).map((ring, index) => {
                ring.style.opacity = '0.7';
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
            });
        } else {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });
            animationRefs.current = [];
            rings.forEach(ring => {
                ring.style.opacity = '0';
            });
        }

        return () => {
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });
            animationRefs.current = [];
        };
    }, [isMicActive]);

    useEffect(() => {
        const btn = micBtnRef.current;
        if (!btn || micBounceTrigger === 0) return;
        btn.classList.add('btn-bounce');
        const timer = setTimeout(() => btn.classList.remove('btn-bounce'), 1000);
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
        const player = currentVideoPlayer;

        if (isTextInputVisible) {
            appStore.getState().setTextInputVisible(false);
            appStore.getState().setMicActive(false);
            if (player && player.play) {
                player.play().catch(e => console.warn('[UI] Video resume failed:', e));
            }
        } else {
            appStore.getState().setTextInputVisible(true);
            appStore.getState().setMicActive(true);
            if (player && player.pause) player.pause();
        }
    };

    return (
        <div ref={containerRef} className={`mic-btn-wrapper${bottomControlState !== 'mic' ? ' d-none' : ''}`} id="state-standard-mic" style={{ display: 'flex' }}>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <button
                ref={micBtnRef}
                className={`btn call-btn ${isMicActive ? '' : 'toggled-off'} ${isTextMode ? 'd-none' : ''}`}
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
