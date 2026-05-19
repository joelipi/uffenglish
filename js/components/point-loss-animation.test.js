import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPointLossAnimation } from './point-loss-animation.js';

describe('Point Loss Animation Component', () => {
    let pointLoss;

    beforeEach(() => {
        document.body.innerHTML = '<span id="listeningScore">100</span>';
        pointLoss = createPointLossAnimation();
    });

    it('should create style element', () => {
        const style = document.querySelector('style');
        expect(style).toBeDefined();
        expect(style.innerHTML).toContain('point-loss-float');
    });

    it('should show animation', () => {
        const target = document.getElementById('listeningScore');
        pointLoss.show(target, 5);

        const activeAnimations = document.querySelectorAll('.point-loss-float');
        expect(activeAnimations.length).toBe(1);
        expect(activeAnimations[0].textContent).toBe('-5');
    });
});
