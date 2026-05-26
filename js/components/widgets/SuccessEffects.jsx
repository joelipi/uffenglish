import { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { shouldShowConfetti } from '../../modules/success-lesson-logic.js';

export default function SuccessEffects() {
  const visible = useStore(appStore, state => state.successScreenVisible);
  const fluencyData = useStore(appStore, state => state.successFluencyData);

  useEffect(() => {
    if (!visible || !fluencyData) return;

    // Play sound
    const { Media } = require('../../modules/media.js');
    Media.playSound('lesson-complete-sound');

    // Show confetti if high score
    if (shouldShowConfetti(fluencyData.total)) {
      import('canvas-confetti').then(confetti => {
        confetti.default({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 }
        });
      });
    }
  }, [visible, fluencyData]);

  return null; // No visual output
}
