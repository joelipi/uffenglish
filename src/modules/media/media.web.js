import { appStore } from '../store/store.js';
import { Howl, Howler } from 'howler';
import correctSound from '../../assets/sounds/correct.mp3';
import incorrectSound from '../../assets/sounds/incorrect.mp3';
import completeSound from '../../assets/sounds/complete.mp3';
import enableAudio from '../../assets/sounds/enableaudio.mp3';

const AUDIO_URLS = {
    'correct-sound': correctSound,
    'incorrect-sound': incorrectSound,
    'lesson-complete-sound': completeSound,
    'enable-audio': enableAudio
};

const audioPlayers = {};

function ensurePlayer(id) {
    if (!audioPlayers[id]) {
        audioPlayers[id] = new Howl({ src: [AUDIO_URLS[id]], preload: true });
    }
    return audioPlayers[id];
}

export const Media = {
    playSound(soundId) {
        if (!AUDIO_URLS[soundId] || !appStore.getState().isAudioEnabled) return;
        ensurePlayer(soundId).play();
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