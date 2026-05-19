import React, { useRef, useState, useEffect } from 'react';

/**
 * React transition for mic-animation.js
 * Manages the CSS animations for the microphone button rings.
 */
export default function MicAnimation({ onMouseDown, onMouseUp, onMouseLeave }) {
    const ring1Ref = useRef(null);
    const ring2Ref = useRef(null);
    const ring3Ref = useRef(null);
    const [animations, setAnimations] = useState([]);

    const startMicAnimation = () => {
        const rings = [ring1Ref.current, ring2Ref.current, ring3Ref.current];
        if (!rings.every(Boolean)) return;

        const duration = 2000;
        const delays = [0, 650, 1300];
        const newAnimations = [];

        rings.forEach((ring, index) => {
            ring.style.opacity = '0.7';
            const anim = ring.animate([
                { transform: 'scale(1)', opacity: 0.7 },
                { transform: 'scale(2.6)', opacity: 0 }
            ], { duration: duration, delay: delays[index], iterations: Infinity, easing: 'ease-out' });
            newAnimations.push(anim);
        });

        setAnimations(newAnimations);
    };

    const stopMicAnimation = () => {
        animations.forEach(anim => anim.cancel());
        setAnimations([]);
        const rings = [ring1Ref.current, ring2Ref.current, ring3Ref.current];
        rings.forEach(ring => {
            if (ring) {
                ring.style.opacity = '0';
                ring.style.transform = 'scale(1)';
            }
        });
    };

    const handleMouseDown = (e) => {
        startMicAnimation();
        if (onMouseDown) onMouseDown(e);
    };

    const handleMouseUp = (e) => {
        stopMicAnimation();
        if (onMouseUp) onMouseUp(e);
    };

    const handleMouseLeave = (e) => {
        stopMicAnimation();
        if (onMouseLeave) onMouseLeave(e);
    };

    // Cleanup animations on unmount
    useEffect(() => {
        return () => {
            animations.forEach(anim => anim.cancel());
        };
    }, [animations]);

    return (
        <div
            className="mic-btn-wrapper"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{ position: 'relative', display: 'inline-block' }}
        >
            <div ref={ring1Ref} className="mic-ring" style={{ position: 'absolute', inset: 0, opacity: 0, borderRadius: '50%', background: 'rgba(0, 123, 255, 0.5)', zIndex: 0 }}></div>
            <div ref={ring2Ref} className="mic-ring" style={{ position: 'absolute', inset: 0, opacity: 0, borderRadius: '50%', background: 'rgba(0, 123, 255, 0.5)', zIndex: 0 }}></div>
            <div ref={ring3Ref} className="mic-ring" style={{ position: 'absolute', inset: 0, opacity: 0, borderRadius: '50%', background: 'rgba(0, 123, 255, 0.5)', zIndex: 0 }}></div>

            <button id="micBtn" style={{ position: 'relative', zIndex: 1 }}>
                <img src="/assets/img/micon.svg" alt="Mic" />
            </button>
        </div>
    );
}
