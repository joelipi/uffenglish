// --- modules/video-loader.js ---
import { InteractiveVideoPlayer } from '../components/interactive-video-player.js';
import { simpleVideoPlayer } from '../components/simple-video-player.js';
import { introBackgroundVideo } from '../components/intro-background-video.js';
import { pointLoss } from '../components/point-loss-animation.js';
import { updateCurrentScoreDisplay } from '../components/ui.js';
import Strings from '../data/strings.js';

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
            cue: question.cue,
            containerSelector: '#ivp-container',
            videoStyles: { maxWidth: '100%' },
            subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' }
        });
        window.currentVideoPlayer = state.player;

        setTimeout(() => {
            try {
                const videoEl = state.player.video;
                videoEl.muted = false;
                videoEl.setAttribute('playsinline', '');
                const playPromise = state.player.play();
                if (playPromise !== undefined) playPromise.catch(() => {});
            } catch (e) {}
        }, 200);

        state.player.video.addEventListener('playing', () => state.player.video.controls = false);

        state.player.video.addEventListener('play', () => {
            state.videoPlays++;
            if (state.videoPlays > 2 && (question.inputType === "speech" || question.inputType === "ai")) {
                state.currentPoints = Math.max(0, state.currentPoints - 10);
                pointLoss.show(state.player.video, 10);
                updateCurrentScoreDisplay(state.currentPoints);
            }
        });

        state.player.video.addEventListener('click', () => {
            state.videoClicks++;
            if (state.videoClicks % 2 === 1 && (question.inputType === "speech" || question.inputType === "ai")) {
                state.currentPoints = Math.max(0, state.currentPoints - 15);
                pointLoss.show(state.player.video, 15);
                updateCurrentScoreDisplay(state.currentPoints);
            }
        });
    }

    if (question.simpleVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(question.simpleVideoUrl);
        state.player = new simpleVideoPlayer({
            videoUrl: currentVideoUrl,
            subtitles: question.subtitles,
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
                if (playPromise !== undefined) playPromise.catch(() => {});
            } catch (e) {}
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