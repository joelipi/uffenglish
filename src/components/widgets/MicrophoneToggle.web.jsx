import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';

export default function MicrophoneToggle() {
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);
    const micBounceTrigger = useStore(appStore, (state) => state.micBounceTrigger);
    const overlayVisible = useStore(appStore, (state) => state.overlayVisible);
    const currentVideo = useStore(appStore, (state) => state.currentVideo);
    const [bouncing, setBouncing] = useState(false);
    const [hasSeenOverlay, setHasSeenOverlay] = useState(false);
    const [earBtnVisible, setEarBtnVisible] = useState(true);
    const ringRefs = useRef([null, null, null]);
    const micBtnRef = useRef(null);
    const animationRefs = useRef([]);
    const videoUrlRef = useRef(null);

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

    useEffect(() => {
        if (currentVideo?.url && currentVideo.url !== videoUrlRef.current) {
            videoUrlRef.current = currentVideo.url;
            setHasSeenOverlay(false);
            setEarBtnVisible(true);
        }
    }, [currentVideo]);

    useEffect(() => {
        if (overlayVisible) setHasSeenOverlay(true);
    }, [overlayVisible]);

    const handleClick = () => {
        const cb = getSpeechInputToggleCallback();
        if (typeof cb === 'function') {
            cb();
        } else {
            console.warn('[MicrophoneToggle] No mic click handler registered.');
        }
    };

    const handleTextClick = () => {
        const isTextInputVisible = appStore.getState().textInputVisible;

        if (isTextInputVisible) {
            appStore.getState().setTextInputVisible(false);
            appStore.getState().setMicActive(false);
            const player = getCurrentVideoPlayer();
            if (player && player.play) {
                player.play().catch(e => console.warn('[UI] Video resume failed:', e));
            }
        } else {
            appStore.getState().setTextInputVisible(true);
            appStore.getState().setMicActive(true);
            appStore.getState().triggerPauseAllVideos();
        }
    };

    const handleEarClick = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.();
        setEarBtnVisible(false);
    };
    const handleMicClick = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.({ replay: false });
        setEarBtnVisible(false);
        handleClick();
    };
    const handleTxtClickOverlay = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.({ replay: false });
        setEarBtnVisible(false);
        handleTextClick();
    };

    const ringStyle = isMicActive ? { opacity: 0.7, pointerEvents: 'none' } : { opacity: 0, pointerEvents: 'none' };
    const shouldShowMic = bottomControlState === 'mic' && (overlayVisible || hasSeenOverlay);

    if (!shouldShowMic) {
        return (
            <div className="mic-btn-wrapper d-none" id="state-standard-mic" style={{ display: 'flex' }} />
        );
    }

    if (overlayVisible && earBtnVisible) {
        return (
            <div className="mic-btn-wrapper" id="state-standard-mic" style={{ display: 'flex', width: '100%', position: 'relative' }}>
                <button
                    className="btn call-btn"
                    id="earBtn"
                    aria-label="Listen again"
                    onClick={handleEarClick}
                    style={{ position: 'absolute', left: 'calc(25vw - 16px)', transform: 'translateX(-50%)' }}
                >
                    <i className="bi bi-ear-fill"></i>
                </button>
                <button
                    ref={micBtnRef}
                    className={`btn call-btn ${isMicActive ? '' : 'toggled-off'} ${isTextMode ? 'd-none' : ''}`}
                    id="micBtn"
                    aria-label="Toggle Microphone"
                    onClick={handleMicClick}
                    style={{ position: 'absolute', right: 'calc(25vw - 16px)', transform: 'translateX(50%)' }}
                >
                    <i className={isMicActive ? "bi bi-mic-fill" : "bi bi-mic-mute-fill"}></i>
                </button>
                <button
                    className={`btn call-btn ${isTextMode ? '' : 'd-none'}`}
                    id="txtBtn"
                    aria-label="Toggle Text Input"
                    onClick={handleTxtClickOverlay}
                    style={{ position: 'absolute', right: 'calc(25vw - 16px)', transform: 'translateX(50%)' }}
                >
                    <i className="bi bi-keyboard-fill"></i>
                </button>
            </div>
        );
    }

    return (
        <div className="mic-btn-wrapper" id="state-standard-mic" style={{ display: 'flex' }}>
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
