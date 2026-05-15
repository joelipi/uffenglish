// --- Mic Ring Animation Module ---

let micAnimations = [];

function startMicAnimation() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;
    const rings = micBtn.parentElement.querySelectorAll('.mic-ring');
    if (rings.length === 0) return;
    const duration = 2000;
    const delays = [0, 650, 1300];
    rings.forEach((ring, index) => {
        ring.style.opacity = '0.7';
        const anim = ring.animate([
            { transform: 'scale(1)', opacity: 0.7 },
            { transform: 'scale(2.6)', opacity: 0 }
        ], { duration: duration, delay: delays[index], iterations: Infinity, easing: 'ease-out' });
        micAnimations.push(anim);
    });
}

function stopMicAnimation() {
    micAnimations.forEach(anim => anim.cancel());
    micAnimations = [];
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;
    const rings = micBtn.parentElement.querySelectorAll('.mic-ring');
    rings.forEach(ring => { ring.style.opacity = '0'; ring.style.transform = 'scale(1)'; });
}

export function initMicAnimation() {
    const wrapper = document.querySelector('.mic-btn-wrapper');
    if (!wrapper) return;
    wrapper.addEventListener('mousedown', (e) => {
        if (e.target.closest('#micBtn')) startMicAnimation();
    });
    wrapper.addEventListener('mouseup', (e) => {
        if (e.target.closest('#micBtn')) stopMicAnimation();
    });
    wrapper.addEventListener('mouseleave', (e) => {
        if (e.target.closest('#micBtn')) stopMicAnimation();
    });
}