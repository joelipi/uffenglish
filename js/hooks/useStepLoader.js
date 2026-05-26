import { useCallback, useRef } from 'react';
import { createLoadStep } from '../modules/step-loader-execute.js';

export function useStepLoader() {
    const micAnims = useRef([]);

    const loadStep = useCallback((step, lesson, fluencyData, deps) => {
        const execute = createLoadStep(
            deps.submitAnswerPrecheck,
            deps.showFeedbackAndProceed,
            deps.handleHint,
            (btn) => {
                // startMicAnimation
                if (!btn) return;
                const rings = btn.parentElement.querySelectorAll('.mic-ring');
                rings.forEach((ring, i) => {
                    ring.style.opacity = '0.7';
                    const anim = ring.animate([
                        { transform: 'scale(1)', opacity: 0.7 },
                        { transform: 'scale(2.6)', opacity: 0 }
                    ], { duration: 2000, delay: [0, 650, 1300][i], iterations: Infinity, easing: 'ease-out' });
                    micAnims.current.push(anim);
                });
            },
            (btn) => {
                // stopMicAnimation
                micAnims.current.forEach(a => a.cancel());
                micAnims.current = [];
                if (!btn) return;
                btn.parentElement.querySelectorAll('.mic-ring').forEach(r => { r.style.opacity = '0'; r.style.transform = 'scale(1)'; });
            }
        );
        return execute(step, lesson, fluencyData);
    }, []);

    return { loadStep };
}
