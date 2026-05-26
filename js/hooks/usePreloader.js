let preloadDiv = null;
let progressBar = null;
let progressInterval = null;

export function usePreloader() {
    const ensurePreloader = () => {
        preloadDiv = document.getElementById('appLoadingImageDiv');
        progressBar = document.getElementById('ui-progress-bar');
        const progressContainer = document.getElementById('ui-progress-container');
        if (progressContainer) progressContainer.style.opacity = '1';
    };

    const startProgressPulse = () => {
        if (!progressBar) return;
        let progress = 0;
        progressInterval = setInterval(() => {
            progress += (95 - progress) * 0.05;
            if (progressBar) progressBar.style.width = progress + '%';
        }, 100);
    };

    const finishPreloader = () => {
        if (progressInterval) clearInterval(progressInterval);
        if (progressBar) progressBar.style.width = '100%';
        setTimeout(() => {
            if (preloadDiv) {
                preloadDiv.style.opacity = '0';
                preloadDiv.style.transition = 'opacity 0.3s ease-out';
                setTimeout(() => { preloadDiv.style.display = 'none'; }, 300);
            }
        }, 250);
    };

    return { ensurePreloader, startProgressPulse, finishPreloader };
}
