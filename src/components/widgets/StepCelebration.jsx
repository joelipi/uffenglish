import { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { runStepCelebration } from '../../modules/lesson/step-celebration.web.js';

/**
 * Fires the end-of-step celebration. Render-only: the store trigger is the
 * input, and every decision (which variant, which shapes, when) lives in
 * step-celebration-logic.js / step-celebration.web.js.
 *
 * No cleanup function on purpose: the runner dedupes by trigger value, so a
 * StrictMode unmount/remount must not cancel the timers the first run
 * scheduled — it would swallow the celebration entirely in development.
 */
export default function StepCelebration() {
    const trigger = useStore(appStore, (state) => state.stepCelebrationTrigger);

    useEffect(() => {
        runStepCelebration({ trigger }).catch((error) => {
            console.warn(
                '[StepCelebration] celebration skipped:',
                error && error.message ? error.message : error
            );
        });
    }, [trigger]);

    return null;
}
