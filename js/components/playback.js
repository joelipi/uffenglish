import { appStore } from '../modules/store.js';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function clearPlaybackVideo() {
    const video = document.getElementById('playback-video');
    if (video) {
        video.pause();
        if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
        video.src = '';
        video.load();
        video.style.display = 'none';
        video.onerror = null;
        video.onloadeddata = null;
        video.onloadedmetadata = null;
    }

    const videoWrapper = document.getElementById('playback-video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'none';
    }

    const muteToggle = document.getElementById('playback-mute-toggle');
    if (muteToggle) muteToggle.classList.add('d-none');
}

export async function setupPlaybackVideo(blob, autoplay = false, speechCamChunks = []) {
    const playbackVideo = document.getElementById('playback-video');
    if (!playbackVideo) return;

    try {
        if (playbackVideo.src && playbackVideo.src.startsWith('blob:')) {
            URL.revokeObjectURL(playbackVideo.src);
        }

        if (isIOS) {
            await setupIOSBlobPlayback(playbackVideo, blob);
        } else {
            playbackVideo.src = URL.createObjectURL(blob);
        }

        const muteToggle = document.getElementById('playback-mute-toggle');
        if (muteToggle) {
            muteToggle.classList.remove('d-none');
            const icon = muteToggle.querySelector('i');
            if (icon) {
                icon.className = appStore.getState().isPlaybackMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
            }
            muteToggle.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const wasMuted = appStore.getState().isPlaybackMuted;
                appStore.getState().setPlaybackMuted(!wasMuted);
                playbackVideo.muted = !wasMuted;
                if (icon) {
                icon.className = !wasMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
                }
            };
        }

        playbackVideo.onerror = (e) => {
            try {
                const fallbackBlob = new Blob(speechCamChunks, { type: 'video/mp4' });
                playbackVideo.src = URL.createObjectURL(fallbackBlob);
            } catch (fallbackError) { }
        };

        playbackVideo.controls = false;
        playbackVideo.loop = true;
        playbackVideo.autoplay = false;
        playbackVideo.preload = 'auto';
        playbackVideo.muted = appStore.getState().isPlaybackMuted || false;
        playbackVideo.style.cursor = 'pointer';

        if (playbackVideo._interactionHandler) {
            playbackVideo.removeEventListener('touchstart', playbackVideo._interactionHandler);
            playbackVideo.removeEventListener('click', playbackVideo._interactionHandler);
        }

        playbackVideo._interactionHandler = function (e) {
            e.preventDefault(); e.stopPropagation();
            requestAnimationFrame(() => {
                if (this.paused) {
                    this.play().catch(e => {
                        this.currentTime = 0;
                        setTimeout(() => this.play().catch(console.error), 100);
                    });
                } else {
                    this.pause();
                }
            });
        };

        playbackVideo.addEventListener('touchstart', playbackVideo._interactionHandler, { passive: false });
        playbackVideo.addEventListener('click', playbackVideo._interactionHandler);

        if (window._playbackObserver) {
            window._playbackObserver.disconnect();
        }
        window._playbackObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting && !playbackVideo.paused) {
                    playbackVideo.pause();
                }
            });
        }, { threshold: 0.1 });

        playbackVideo.onloadedmetadata = () => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (wrapper) {
                const videoFrame = document.querySelector('.video-frame');
                if (videoFrame && wrapper.parentElement !== videoFrame) {
                    videoFrame.appendChild(wrapper);
                }
                wrapper.classList.remove('d-none');
                wrapper.style.display = 'flex';

                // Clear any inline styles set by VideoBubble chat bubble conversion
                wrapper.style.width = '';
                wrapper.style.height = '';
                playbackVideo.style.width = '';
                playbackVideo.style.height = '';
                playbackVideo.style.maxHeight = '';
                playbackVideo.style.borderRadius = '';
                playbackVideo.style.objectFit = '';

                // Set absolute positioning so it floats correctly inside video-frame
                wrapper.style.position = 'absolute';
                wrapper.style.top = '15%';
                wrapper.style.left = '0';
                wrapper.style.right = '0';
                wrapper.style.zIndex = '5';
            }

            playbackVideo.style.display = 'block';
            if (autoplay) {
                playbackVideo.play().catch(e => {
                    console.warn('[Playback] autoplay failed:', e);
                    if (e.name === 'NotAllowedError') {
                        // Fallback to muted playback if browser blocks unmuted
                        playbackVideo.muted = true;
                        appStore.getState().setPlaybackMuted(true);
                        const muteToggle = document.getElementById('playback-mute-toggle');
                        if (muteToggle) {
                            const icon = muteToggle.querySelector('i');
                            if (icon) icon.className = 'bi bi-volume-mute-fill';
                        }
                        playbackVideo.play().catch(err => console.error('[Playback] muted fallback failed:', err));
                    }
                });
            }

            // Observe visibility AFTER making it visible, using requestAnimationFrame
            requestAnimationFrame(() => {
                if (window._playbackObserver) {
                    window._playbackObserver.observe(playbackVideo);
                }
            });
        };

    } catch (urlError) { }
}

async function setupIOSBlobPlayback(videoElement, blob) {
    return new Promise((resolve) => {
        videoElement.controls = true; videoElement.loop = true;
        const url = URL.createObjectURL(blob);
        videoElement.onerror = () => {
            try {
                const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
                videoElement.src = URL.createObjectURL(alternativeBlob);
                resolve();
            } catch (fallbackError) {
                resolve();
            }
        };
        videoElement.src = url;
        videoElement.onloadeddata = () => resolve();
        setTimeout(() => resolve(), 2000);
    });
}
