// --- modules/media-web.js ---
import { State } from './state.js';

const AUDIO_URLS = {
    'correct-sound': 'assets/sounds/correct.mp3',
    'incorrect-sound': 'assets/sounds/incorrect.mp3',
    'lesson-complete-sound': 'assets/sounds/complete.mp3'
};

const audioPlayers = {
    'enable-audio': new Audio('assets/sounds/enableaudio.mp3')
};
for (const [id, url] of Object.entries(AUDIO_URLS)) {
    audioPlayers[id] = new Audio(url);
}

export const Media = {
    playSound(soundId) {
        if (!audioPlayers[soundId]) return;
        if (!State.isAudioEnabled) return;
        audioPlayers[soundId].currentTime = 0;
        audioPlayers[soundId].play().catch(error => { });
    },

    pauseVideoIfPlaying() {
        const videoElement = document.querySelector('video.ivp-video');
        if (videoElement && !videoElement.paused) videoElement.pause();
    },

    cleanupPreviousPlayers() {
        if (window.currentVideoPlayer) {
            window.currentVideoPlayer.destroy ? window.currentVideoPlayer.destroy() : (window.currentVideoPlayer.video.pause(), window.currentVideoPlayer.video.src = '', window.currentVideoPlayer.video.load());
            window.currentVideoPlayer = null;
        }
        if (window.currentSimpleVideoPlayer) {
            window.currentSimpleVideoPlayer.destroy ? window.currentSimpleVideoPlayer.destroy() : (window.currentSimpleVideoPlayer.video.pause(), window.currentSimpleVideoPlayer.video.src = '', window.currentSimpleVideoPlayer.video.load());
            window.currentSimpleVideoPlayer = null;
        }
        if (window.currentIntroVideoPlayer) {
            window.currentIntroVideoPlayer.destroy ? window.currentIntroVideoPlayer.destroy() : null;
            window.currentIntroVideoPlayer = null;
        }
        document.querySelectorAll('video').forEach(media => {
            // Do not clear the webcam preview or AI avatar video
            if (media.id === 'webcam-preview' || media.id === 'chat-avatar-ai') return;

            media.pause();
            media.currentTime = 0;
            if (media.src) { media.src = ''; media.load(); }
        });
    },

    async enableAudioSystem() {
        try {
            await audioPlayers['enable-audio'].play().catch(e => { if (e.name !== 'AbortError') throw e; });
            State.isAudioEnabled = true;
        } catch (error) {
            console.error("Audio system enablement failed:", error);
        }
    },

    preloader: {
        video: null,
        init(url) {
            this.video = document.createElement('video');
            this.video.src = url;
            this.video.muted = false;
            this.video.setAttribute('playsinline', '');
            this.video.style.display = 'none';
            document.body.appendChild(this.video);
        },
        play() {
            if (this.video) return this.video.play().catch(e => Promise.reject(e));
            return Promise.reject('No video element');
        },
        preloadOnly(url) { this.init(url); }
    }
};

