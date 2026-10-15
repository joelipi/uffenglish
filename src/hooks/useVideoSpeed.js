import { useCallback, useEffect, useState } from 'react';
import { nextVideoSpeed, applyVideoSpeed } from '../modules/video/video-speed-logic.js';

// Shared snail-toggle state (1x -> 0.8x -> 0.6x -> 1x) for every
// non-interactive video surface. Owns the rate state, the per-clip reset
// and the element sync so the four surfaces share one contract instead of
// copy-pasting three effects each. InteractiveVideoPlayer is excluded: its
// playbackRate is scoring-coupled (interactive-video-controller.js).
export function useVideoSpeed(videoRef, resetKey) {
    const [rate, setRate] = useState(1);

    // A slowed rate must never leak into the next clip.
    useEffect(() => { setRate(1); }, [resetKey]);

    // The rule (which rates exist) lives in video-speed-logic.js; this
    // effect only writes the result onto the element.
    useEffect(() => {
        if (videoRef.current) applyVideoSpeed(videoRef.current, rate);
    }, [rate, resetKey]);

    // Called with the toggle's computed next rate; falls back to advancing
    // from the current rate so a bare onCycle() still cycles.
    const cycle = useCallback((next) => {
        setRate(next ?? nextVideoSpeed(rate));
    }, [rate]);

    return [rate, cycle];
}
