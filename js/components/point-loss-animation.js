// pointLossAnimation.js - Module for showing point loss animations

class PointLossAnimation {
    constructor(options = {}) {
        this.injected = false;
        this.options = {
            duration: options.duration || 1500,
            fontSize: options.fontSize || '2.5em',
            color: options.color || '#ff4757',
            fontFamily: options.fontFamily || 'Orbitron, monospace',
            textShadow: options.textShadow || '2px 2px 4px rgba(0,0,0,0.5)',
            ...options
        };

        this.injectStyles();
    }

    injectStyles() {
        if (this.injected) return;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = `
            .point-loss-float {
                position: fixed;
                font-family: ${this.options.fontFamily};
                font-size: ${this.options.fontSize};
                font-weight: bold;
                color: ${this.options.color};
                pointer-events: none;
                z-index: 10000;
                text-shadow: ${this.options.textShadow};
                transform: translate(-50%, -50%);
            }

            @keyframes pointLossFloatAnim {
                0% {
                    opacity: 1;
                    transform: translate(-50%, -50%) translateY(0) scale(1);
                }
                20% {
                    transform: translate(-50%, -50%) translateY(-10px) scale(1.2);
                }
                100% {
                    opacity: 0;
                    transform: translate(-50%, -50%) translateY(-60px) scale(0.8);
                }
            }

            .point-loss-float.animate {
                animation: pointLossFloatAnim ${this.options.duration}ms ease-out forwards;
            }
        `;

        document.head.appendChild(styleSheet);
        this.injected = true;
    }

    show(element, points) {
        const pointLossEl = document.createElement('div');
        pointLossEl.className = 'point-loss-float';
        pointLossEl.textContent = `-${points}`;

        const rect = element.getBoundingClientRect();
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;

        pointLossEl.style.left = elementCenterX + 'px';
        pointLossEl.style.top = elementCenterY + 'px';

        document.body.appendChild(pointLossEl);

        requestAnimationFrame(() => {
            pointLossEl.classList.add('animate');
        });

        setTimeout(() => {
            if (pointLossEl.parentNode) {
                pointLossEl.parentNode.removeChild(pointLossEl);
            }
        }, this.options.duration);
    }

    showRelative(element, points) {
        const pointLossEl = document.createElement('div');
        pointLossEl.className = 'point-loss-float';
        pointLossEl.textContent = `-${points}`;

        pointLossEl.style.position = 'absolute';
        pointLossEl.style.left = '50%';
        pointLossEl.style.top = '50%';

        const originalPosition = window.getComputedStyle(element).position;
        if (originalPosition === 'static') {
            element.style.position = 'relative';
        }

        element.appendChild(pointLossEl);

        requestAnimationFrame(() => {
            pointLossEl.classList.add('animate');
        });

        setTimeout(() => {
            if (pointLossEl.parentNode) {
                pointLossEl.parentNode.removeChild(pointLossEl);
            }
            if (originalPosition === 'static') {
                element.style.position = '';
            }
        }, this.options.duration);
    }
}

function createPointLossAnimation(options) {
    return new PointLossAnimation(options);
}

const pointLoss = new PointLossAnimation();

export { PointLossAnimation, createPointLossAnimation, pointLoss };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PointLossAnimation, createPointLossAnimation, pointLoss };
}

if (typeof window !== 'undefined') {
    window.PointLoss = { PointLossAnimation, createPointLossAnimation, pointLoss };
}
