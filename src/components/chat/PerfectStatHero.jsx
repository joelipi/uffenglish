import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export default function PerfectStatHero({ children, delay, onHeroComplete, onExitComplete }) {
    const [phase, setPhase] = useState('idle');
    const containerRef = useRef(null);
    const timerRef = useRef(null);

    const startExit = useCallback(() => {
        setPhase('exiting');
    }, []);

    const handleExitEnd = useCallback(() => {
        onExitComplete();
    }, [onExitComplete]);

    useEffect(() => {
        timerRef.current = setTimeout(() => {
            setPhase('entering');
        }, delay);
        return () => clearTimeout(timerRef.current);
    }, [delay]);

    const handleEntryEnd = useCallback(() => {
        if (onHeroComplete) onHeroComplete();
        // Pause briefly in the center before exiting
        setTimeout(() => {
            startExit();
        }, 800); 
    }, [onHeroComplete, startExit]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        
        const handler = (e) => {
            if (e.target === el || el.contains(e.target)) {
                if (phase === 'entering') handleEntryEnd();
                else if (phase === 'exiting') handleExitEnd();
            }
        };
        
        el.addEventListener('animationend', handler);
        return () => el.removeEventListener('animationend', handler);
    }, [phase, handleEntryEnd, handleExitEnd]);

    if (phase === 'done' || phase === 'idle') return null;

    return createPortal(
        <div id="hero-portal">
            <div
                ref={containerRef}
                className={`hero-animation-container ${phase === 'entering' ? 'perfect-hero-enter' : ''} ${phase === 'exiting' ? 'perfect-hero-exit' : ''}`}
            >
                {children}
            </div>
        </div>,
        document.getElementById('chat-window-container') || document.body
    );
}