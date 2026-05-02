// pointLossAnimation.js - Module for showing point loss animations

class PointLossAnimation {
    constructor(options = {}) {
        this.injected = false;
        this.options = {
            duration: options.duration || 1500,
            fontSize: options.fontSize || '2.5em',
            color: options.color || '#ff4757',
            fontFamily: options.fontFamily || 'Orbitron, monospace', // Added fallback
            textShadow: options.textShadow || '2px 2px 4px rgba(0,0,0,0.5)',
            ...options
        };
        
        this.injectStyles();
    }

    // Inject the required CSS styles
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

    // Show point loss animation at element position
    show(element, points) {
        // Create the floating text element
        const pointLossEl = document.createElement('div');
        pointLossEl.className = 'point-loss-float';
        pointLossEl.textContent = `-${points}`;
        
        // Get element position
        const rect = element.getBoundingClientRect();
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;
        
        // Position the animation element
        pointLossEl.style.left = elementCenterX + 'px';
        pointLossEl.style.top = elementCenterY + 'px';
        
        // Add to document
        document.body.appendChild(pointLossEl);
        
        // Trigger animation
        requestAnimationFrame(() => {
            pointLossEl.classList.add('animate');
        });
        
        // Remove element after animation completes
        setTimeout(() => {
            if (pointLossEl.parentNode) {
                pointLossEl.parentNode.removeChild(pointLossEl);
            }
        }, this.options.duration);
    }

    // Alternative method for relative positioning within element
    showRelative(element, points) {
        // Create the floating text element
        const pointLossEl = document.createElement('div');
        pointLossEl.className = 'point-loss-float';
        pointLossEl.textContent = `-${points}`;
        
        // Override position for relative positioning
        pointLossEl.style.position = 'absolute';
        pointLossEl.style.left = '50%';
        pointLossEl.style.top = '50%';
        
        // Store original position and set relative if needed
        const originalPosition = window.getComputedStyle(element).position;
        if (originalPosition === 'static') {
            element.style.position = 'relative';
        }
        
        // Add to the element
        element.appendChild(pointLossEl);
        
        // Trigger animation
        requestAnimationFrame(() => {
            pointLossEl.classList.add('animate');
        });
        
        // Remove element and restore positioning
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

// Factory function for easier usage
function createPointLossAnimation(options) {
    return new PointLossAnimation(options);
}

// Default instance for immediate use
const pointLoss = new PointLossAnimation();

// Export for different module systems
export { PointLossAnimation, createPointLossAnimation, pointLoss };

// Also support CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PointLossAnimation, createPointLossAnimation, pointLoss };
}

// For script tag usage (creates global variable)
if (typeof window !== 'undefined') {
    window.PointLoss = { PointLossAnimation, createPointLossAnimation, pointLoss };
}
