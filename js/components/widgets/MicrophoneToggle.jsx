import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { State } from '../../modules/state.js';

export default function MicrophoneToggle() {
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const containerRef = useRef(null);
    const animationRefs = useRef([]);

    useEffect(() => {
        if (!containerRef.current) return;
        const rings = containerRef.current.querySelectorAll('.mic-ring');

        if (isMicActive) {
            // Start animation
            const duration = 2000;
            const delays = [0, 650, 1300];
            
            // Cancel any existing animations first
            animationRefs.current.forEach(anim => {
                try { anim.cancel(); } catch (e) {}
            });
            
            animationRefs.current = Array.from(rings).map((ring, index) => {
                ring.style.opacity = '0.7';
                const anim = ring.animate([
                    { transform: 'scale(1)', opacity: 0.7 },
                    { transform: 'scale(2.6)', opacity: 0 }
                ], {
                    duration: duration,
                    delay: delays[index],
                    iterations: Infinity,
                    easing: 'ease-out'
                });
                return anim;
            });
        } else {
            // Stop animation
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

    const micOnClick = typeof window.onMicClick === 'function' ? window.onMicClick : null;

    const handleClick = () => {
        if (micOnClick) micOnClick();
    };

    const handleTextClick = () => {
        const answerInputArea = document.getElementById('answer-input-area');
        if (answerInputArea) {
            const isHiding = !answerInputArea.classList.contains('d-none');
            
            if (isHiding) {
                // CLOSING
                answerInputArea.classList.add('d-none');
                appStore.getState().setMicActive(false);
                if (typeof window.isMicActive !== 'undefined') window.isMicActive = false;
                
                const player = window.State?.player || window.currentVideoPlayer;
                if (player && player.play) {
                    player.play().catch(e => console.warn('[UI] Video resume failed:', e));
                }
                console.log('[UI] Text area hidden, video resumed');
            } else {
                // OPENING
                answerInputArea.classList.remove('d-none');
                appStore.getState().setMicActive(true);
                if (typeof window.isMicActive !== 'undefined') window.isMicActive = true;
                
                const player = window.State?.player || window.currentVideoPlayer;
                if (player && player.pause) player.pause();
                console.log('[UI] Text area shown, video paused');
            }
        }
    };

    return (
        <div ref={containerRef} className="mic-btn-wrapper" id="state-standard-mic" style={{ display: 'flex' }}>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <div className="mic-ring" style={{ opacity: 0, pointerEvents: 'none' }}></div>
            <button
                className={`btn call-btn ${isMicActive ? '' : 'toggled-off'} ${isTextMode ? 'd-none' : ''}`}
                id="micBtn"
                aria-label="Toggle Microphone"
                disabled={!micOnClick}
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
