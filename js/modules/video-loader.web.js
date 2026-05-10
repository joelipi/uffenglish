// --- modules/video-loader.web.js ---
import { InteractiveVideoPlayer } from '../components/interactive-video-player.js';
import { simpleVideoPlayer } from '../components/simple-video-player.js';
import { introBackgroundVideo } from '../components/intro-background-video.js';
import { pointLoss } from '../components/point-loss-animation.js';
import { appStore } from './store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';

const FIREBASE_BASE = 'https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F';

function resolveVideoUrl(slug) {
    return (window.preloadedMedia && window.preloadedMedia[slug])
        ? window.preloadedMedia[slug]
        : `${FIREBASE_BASE}${slug}.mp4?alt=media`;
}

/**
 * Constructs and starts the correct video player for a given question.
 * Attaches play/click penalty event listeners for interactive video questions.
 * Writes to state.player and the relevant window.current*Player global.
 *
 * @param {Object} question - The current question object
 * @param {Object} state - The State singleton from modules/state.js
 * @param {string} lang - The user's native language code (e.g. 'es')
 */
export function loadVideoForQuestion(question, state, lang) {
    if (question.videoUrl) {
        const currentVideoUrl = resolveVideoUrl(question.videoUrl);
        state.player = new InteractiveVideoPlayer({
            videoUrl: currentVideoUrl,
            cue: getLocalizedTranslation(question.cue, lang),
            containerSelector: '#ivp-container',
            videoStyles: { maxWidth: '100%' },
            subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            onRepetition: () => {
                appStore.getState().deductListeningScore(10);
                const scoreEl = document.getElementById('currentScore');
                if (scoreEl) pointLoss.show(scoreEl, 10);
            },
            onWordReveal: (index) => {
                appStore.getState().deductListeningScore(15);
                const scoreEl = document.getElementById('currentScore');
                if (scoreEl) pointLoss.show(scoreEl, 15);
            }
        });
        window.currentVideoPlayer = state.player;

        setTimeout(() => {
            try {
                const videoEl = state.player.video;
                videoEl.muted = false;
                videoEl.setAttribute('playsinline', '');
                const playPromise = state.player.play();
                if (playPromise !== undefined) playPromise.catch(() => { });
            } catch (e) { }
        }, 200);

        state.player.video.addEventListener('playing', () => state.player.video.controls = false);

        // Flag to prevent double-penalty when a click triggers a play event.
        // When the user clicks the video, the browser fires both 'click' and 'play'.
        // The click listener sets this flag so the play listener knows to skip its penalty.
        let clickTriggeredPlay = false;

        state.player.video.addEventListener('play', () => {
            if (clickTriggeredPlay) {
                // This play was caused by a click — click listener already handled the penalty
                clickTriggeredPlay = false;
                return;
            }
            state.videoPlays++;
            if (state.videoPlays > 2 && (question.inputType === "speech" || question.inputType === "ai")) {
                appStore.getState().deductListeningScore(10);
                pointLoss.show(state.player.video, 10);
                // Subscription handles the score display update
            }
        });

        state.player.video.addEventListener('click', () => {
            state.videoClicks++;
            if (state.videoClicks % 2 === 1 && (question.inputType === "speech" || question.inputType === "ai")) {
                // Set flag before the play event fires so the play listener skips its penalty
                clickTriggeredPlay = true;
                appStore.getState().deductListeningScore(15);
                pointLoss.show(state.player.video, 15);
                // Subscription handles the score display update
            }
        });
    }

    if (question.simpleVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(question.simpleVideoUrl);
        state.player = new simpleVideoPlayer({
            videoUrl: currentVideoUrl,
            subtitles: getLocalizedTranslation(question.subtitles, lang),
            containerSelector: '#simple-ivp-container',
            videoStyles: { maxWidth: '100%' },
            subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' }
        });
        window.currentSimpleVideoPlayer = state.player;

        setTimeout(() => {
            try {
                const videoEl = state.player.video;
                videoEl.muted = false;
                const playPromise = state.player.play();
                if (playPromise !== undefined) playPromise.catch(() => { });
            } catch (e) { }
        }, 200);
    }

    if (question.introBackgroundVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(question.introBackgroundVideoUrl);
        state.player = new introBackgroundVideo({
            videoUrl: currentVideoUrl,
            title: Strings.get('incoming_video', lang) || 'INCOMING VIDEO',
            subtitle: Strings.get('video_incoming', lang) || 'VIDEO ENTRANTE',
            name: 'Joe Walsh',
            role: Strings.get('english_coach', lang) || 'English Coach, UFF',
            alertText: Strings.get('press_webcam', lang) || 'Press the webcam button below. Oprime el botón de cámara abajo.'
        });
        window.currentIntroVideoPlayer = state.player;
    }
}