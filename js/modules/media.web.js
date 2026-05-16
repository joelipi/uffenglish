import { State } from './state.js';
import { Howl, Howler } from 'howler';

const AUDIO_URLS = {
    'correct-sound': 'assets/sounds/correct.mp3',
    'incorrect-sound': 'assets/sounds/incorrect.mp3',
    'lesson-complete-sound': 'assets/sounds/complete.mp3',
    'enable-audio': 'assets/sounds/enableaudio.mp3'
};

const audioPlayers = {};
for (const [id, url] of Object.entries(AUDIO_URLS)) {
    audioPlayers[id] = new Howl({ src: [url], preload: true });
}

export const Media = {
    playSound(soundId) {
        if (!audioPlayers[soundId] || !State.isAudioEnabled) return;
        audioPlayers[soundId].play();
    },

    pauseVideoIfPlaying() {
        document.querySelectorAll('video.ivp-video, video.intro-video, #playback-video').forEach(video => {
            if (!video.paused) video.pause();
        });
    },

    cleanupPreviousPlayers() {
        // Restore window.* player teardown (was accidentally dropped in v3)
        const players = [
            'currentVideoPlayer',
            'currentSimpleVideoPlayer',
            'currentIntroVideoPlayer'
        ];
        for (const key of players) {
            if (window[key]) {
                window[key].destroy?.();
                window[key] = null;
            }
        }

        document.querySelectorAll('video.ivp-video, video.intro-video').forEach(media => {
            media.pause();
            media.removeAttribute('src');
            media.load();
        });
    },

    async enableAudioSystem() {
        try {
            // Howler.ctx is only available after AudioContext is created.
            // It may be null before any user gesture on iOS/Chrome.
            if (Howler.ctx?.state === 'suspended') {
                await Howler.ctx.resume();
            }
            audioPlayers['enable-audio'].play();
            State.isAudioEnabled = true;
        } catch (error) {
            console.warn('[Media] Audio unlock failed — will retry on next interaction.', error);
        }
    },

    preloader: {
        video: null,
        preloadOnly(url) {
            if (!this.video) {
                this.video = document.createElement('video');
                this.video.muted = true;
                this.video.setAttribute('playsinline', '');
                this.video.style.display = 'none';
                this.video.id = 'media-preloader-element';
                document.body.appendChild(this.video);
            }
            if (url && this.video.src !== url) {
                this.video.src = url;
                this.video.load();
            }
        },
        destroy() {
            if (this.video) {
                this.video.remove();
                this.video = null;
            }
        }
    }
};