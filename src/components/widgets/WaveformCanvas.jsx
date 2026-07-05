import React, { useRef, useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

const BAR_COLOR_UNPLAYED = 'rgba(255, 255, 255, 0.2)';
const PLAYHEAD_COLOR = '#ffffff';
const GRADIENT_TOP = '#3a8fd5';
const GRADIENT_BOTTOM = '#00c0d8';

export default function WaveformCanvas() {
    const recordedAudioPeaks = useStore(appStore, (s) => s.recordedAudioPeaks);
    const canvasRef = useRef(null);
    const rafRef = useRef(null);

    useEffect(() => {
        if (!recordedAudioPeaks) return;
        const { peaks, durationMs } = recordedAudioPeaks;
        if (!peaks || peaks.length === 0) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const displayWidth = canvas.clientWidth || 600;
        const displayHeight = canvas.clientHeight || 120;
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        ctx.scale(dpr, dpr);

        const duration = durationMs > 0 ? durationMs : 3000;
        let startTime = performance.now();

        const gradient = ctx.createLinearGradient(0, 0, 0, displayHeight);
        gradient.addColorStop(0, GRADIENT_TOP);
        gradient.addColorStop(1, GRADIENT_BOTTOM);

        const draw = (now) => {
            ctx.clearRect(0, 0, displayWidth, displayHeight);

            const elapsed = (now - startTime) % duration;
            const progress = elapsed / duration;

            const barCount = peaks.length;
            const barWidth = displayWidth / barCount;
            const centerY = displayHeight / 2;
            const maxBarHeight = displayHeight * 0.85;
            const gap = Math.max(1, barWidth * 0.15);
            const actualBarWidth = barWidth - gap;

            for (let i = 0; i < barCount; i++) {
                const barProgress = i / barCount;
                const rawHeight = peaks[i] * maxBarHeight;
                const h = Math.max(rawHeight, 2);

                if (barProgress <= progress) {
                    ctx.fillStyle = gradient;
                } else {
                    ctx.fillStyle = BAR_COLOR_UNPLAYED;
                }

                const x = i * barWidth + gap / 2;
                const y = centerY - h / 2;
                ctx.fillRect(x, y, actualBarWidth, h);
            }

            const playheadX = progress * displayWidth;
            ctx.strokeStyle = PLAYHEAD_COLOR;
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(playheadX, 0);
            ctx.lineTo(playheadX, displayHeight);
            ctx.stroke();
            ctx.shadowBlur = 0;

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [recordedAudioPeaks]);

    if (!recordedAudioPeaks) return null;

    return (
        <div className="waveform-container">
            <canvas ref={canvasRef} className="waveform-canvas" />
        </div>
    );
}
