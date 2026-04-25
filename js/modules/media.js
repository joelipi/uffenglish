// --- modules/media.js ---
import { State } from './state.js';

const audioPlayer = new Audio('/wp-content/themes/twentytwentyfive-child/sounds/enableaudio.mp3');

const AUDIO_URLS = {
    'correct-sound': '/wp-content/themes/twentytwentyfive-child/sounds/correct.mp3',
    'incorrect-sound': '/wp-content/themes/twentytwentyfive-child/sounds/incorrect.mp3',
    'lesson-complete-sound': '/wp-content/themes/twentytwentyfive-child/sounds/complete.mp3'
};

export const Media = {
    playSound(soundId) {
        if (!AUDIO_URLS[soundId]) return;
        if (!State.isAudioEnabled) return;
        audioPlayer.src = AUDIO_URLS[soundId];
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(error => {});
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
        document.querySelectorAll('video').forEach(media => { 
            media.pause(); 
            media.currentTime = 0; 
            if (media.src) { media.src = ''; media.load(); } 
        });
    },

    async enableAudioSystem() {
        try {
            await audioPlayer.play().catch(e => { if (e.name !== 'AbortError') throw e; });
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
