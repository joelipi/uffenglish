import { Audio } from 'expo-av';
import { useVideoPlayer } from 'expo-video';
import { State } from './state.js';

const AUDIO_URLS = {
    'correct-sound': require('../assets/sounds/correct.mp3'),
    'incorrect-sound': require('../assets/sounds/incorrect.mp3'),
    'lesson-complete-sound': require('../assets/sounds/complete.mp3'),
    'enable-audio': require('../assets/sounds/enableaudio.mp3')
};

// Holds loaded expo-av Sound instances
const audioPlayers = {};

// ---
// Audio loading is async on native. Call Media.init() once at app startup
// (e.g. in your root component or app entry point) before any sounds play.
// ---
async function loadSounds() {
    await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,       // Respect the ringer switch
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
    });

    for (const [id, source] of Object.entries(AUDIO_URLS)) {
        const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false });
        audioPlayers[id] = sound;
    }
}

export const Media = {
    // Must be awaited at app startup before playSound is called
    async init() {
        try {
            await loadSounds();
            State.isAudioEnabled = true;
        } catch (error) {
            console.warn('[Media] Sound preload failed:', error);
        }
    },

    async playSound(soundId) {
        if (!audioPlayers[soundId] || !State.isAudioEnabled) return;
        try {
            // Rewind before play so rapid triggers don't queue silently
            await audioPlayers[soundId].setPositionAsync(0);
            await audioPlayers[soundId].playAsync();
        } catch (error) {
            console.warn(`[Media] playSound failed (${soundId}):`, error);
        }
    },

    // On native, video is managed by expo-video's useVideoPlayer hook
    // inside your component. This is a no-op stub so call sites don't break.
    pauseVideoIfPlaying() {
        // Video pause on native is handled via the VideoPlayer ref in your component.
        // If you hold a ref here, you can call: nativeVideoRef.current?.pause()
    },

    cleanupPreviousPlayers() {
        // Unload all audio to free memory
        for (const [id, sound] of Object.entries(audioPlayers)) {
            sound.unloadAsync().catch(() => { });
            delete audioPlayers[id];
        }
        // Re-trigger init so sounds are available again if needed
        // Alternatively, only call this on true screen teardown
    },

    async enableAudioSystem() {
        // On native, audio mode is set during init().
        // This is a no-op unless init() hasn't been called yet.
        if (!State.isAudioEnabled) {
            await this.init();
        }
    },

    // Native has no DOM preloader. expo-video handles buffering internally
    // via useVideoPlayer — no manual preloading needed.
    preloader: {
        preloadOnly(_url) {
            // No-op on native. Pass the URI directly to your VideoView component.
        },
        destroy() {
            // No-op on native.
        }
    }
};