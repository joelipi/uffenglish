import { appStore } from './store.js';
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
        if (!audioPlayers[soundId] || !appStore.getState().isAudioEnabled) return;
        audioPlayers[soundId].play();
    },

    pauseVideoIfPlaying() {
        // Pausing is now driven by store triggerPauseAllVideos — each video
        // component subscribes to pauseAllVideosTrigger and pauses via its ref.
    },

    cleanupPreviousPlayers() {
        // React handles video teardown via component lifecycle on `currentVideo` change.
    },

    async enableAudioSystem() {
        try {
            // Howler.ctx is only available after AudioContext is created.
            // It may be null before any user gesture on iOS/Chrome.
            if (Howler.ctx?.state === 'suspended') {
                await Howler.ctx.resume();
            }
            // audioPlayers['enable-audio'].play();
            appStore.getState().setAudioEnabled(true);
        } catch (error) {
            console.warn('[Media] Audio unlock failed — will retry on next interaction.', error);
        }
    },

    preloader: {
        preloadOnly(url) {
            if (!url) return;
            // Intentional raw fetch() — browser cache-warming side effect, not data retrieval.
            // The response is never read; TanStack Query would add overhead with zero benefit.
            fetch(url, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
        },
        destroy() {
            // fetch-based preloading needs no cleanup
        }
    }
};