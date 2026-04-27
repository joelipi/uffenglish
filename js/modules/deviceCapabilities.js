export function getDeviceCapabilities() {
    let lowPower = false;
    let appleOldDevice = false;

    // Check Memory
    if (typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 4) {
        lowPower = true;
    }

    // Check Hardware Concurrency
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        lowPower = true;
    }

    // Check WebGL UNMASKED_RENDERER_WEBGL for Apple GPU substrings indicating old devices
    try {
        if (typeof document !== 'undefined') {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                    if (renderer) {
                        const lowerRenderer = renderer.toLowerCase();
                        if (lowerRenderer.includes('apple') && (lowerRenderer.includes('a14') || lowerRenderer.includes('a13') || lowerRenderer.includes('a12') || lowerRenderer.includes('a11'))) {
                            appleOldDevice = true;
                            lowPower = true;
                        } else if (lowerRenderer.includes('apple gpu') && (lowerRenderer.includes('a14') || lowerRenderer.includes('a13') || lowerRenderer.includes('a12') || lowerRenderer.includes('a11'))) {
                            appleOldDevice = true;
                            lowPower = true;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Could not determine WebGL renderer', e);
    }

    return { lowPower, appleOldDevice };
}

export function canRunGector() {
    const caps = getDeviceCapabilities();
    return !caps.lowPower;
}
