import { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { shouldShowConfetti } from '../../modules/lesson/success-lesson-logic.js';
import { buildSuccessFireworkPlan } from '../../modules/lesson/success-fireworks-logic.js';
import { Media } from '../../modules/media/media.js';

export default function SuccessEffects() {
  const visible = useStore(appStore, state => state.successScreenVisible);
  const fluencyData = useStore(appStore, state => state.successFluencyData);

  useEffect(() => {
    if (!visible || !fluencyData) return undefined;

    Media.playSound('lesson-complete-sound');

    // The volleys are scheduled over ~700 ms; the effect must be able to cancel
    // them. Without this, a re-run (or unmount) fires the tail of the show against
    // a screen that is gone, and two runs can double-schedule the same volleys.
    let cancelled = false;
    const volleyTimers = [];

    if (shouldShowConfetti(fluencyData.total)) {
      // The ending is the special one by SCALE, not by a different palette
      // (stories/095): three volleys at once from left/centre/right, then a wide
      // closing volley — all in the app's colours, with the amber accent.
      import('canvas-confetti').then((mod) => {
        if (cancelled) return;
        const confetti = (mod && mod.default) || mod;
        if (typeof confetti !== 'function') return;
        buildSuccessFireworkPlan().forEach((burst) => {
          volleyTimers.push(setTimeout(() => {
            if (cancelled) return;
            try {
              confetti(burst.options);
            } catch (error) {
              console.warn('[SuccessEffects] firework volley failed:', error && error.message ? error.message : error);
            }
          }, burst.delayMs));
        });
      }).catch((error) => {
        console.warn('[SuccessEffects] confetti unavailable:', error && error.message ? error.message : error);
      });
    }

    return () => {
      cancelled = true;
      volleyTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [visible, fluencyData]);

  return null;
}
