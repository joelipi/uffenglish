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

function playWhenReady(player) {
    const checkAndPlay = () => {
        const preloader = document.getElementById('appLoadingImageDiv');
        if (preloader && preloader.style.display !== 'none') {
            setTimeout(checkAndPlay, 100);
            return;
        }
        try {
            const playPromise = player.play();
            if (playPromise !== undefined) playPromise.catch(() => { });
        } catch (e) { }
    };
    setTimeout(checkAndPlay, 200);
}

export function loadVideoForStep(step, state, lang) {
    if (step.videoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.videoUrl);
        state.player = new InteractiveVideoPlayer({
            videoUrl: currentVideoUrl,
            cue: getLocalizedTranslation(step.cue, lang),
            containerSelector: '#ivp-container',
            videoStyles: { maxWidth: '100%' },
            subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            onRepetition: () => {
                appStore.getState().deductListeningScore(10);
                const scoreEl = document.getElementById('listeningScore');
                if (scoreEl) pointLoss.show(scoreEl, 10);
            },
            onWordReveal: (index) => {
                appStore.getState().deductListeningScore(15);
                const scoreEl = document.getElementById('listeningScore');
                if (scoreEl) pointLoss.show(scoreEl, 15);
            }
        });

        window.currentVideoPlayer = state.player;

        try {
            const videoEl = state.player.video;
            videoEl.muted = false;
            videoEl.setAttribute('playsinline', '');
            playWhenReady(state.player);
        } catch (e) { }

        state.player.video.addEventListener('playing', () => state.player.video.controls = false);

        let clickTriggeredPlay = false;
        state.player.video.addEventListener('play', () => {
            // FIX: If the mic is active, DO NOT let the IVP timer auto-play the video!
            if (window.isMicActive) {
                state.player.video.pause();
                return;
            }

            if (clickTriggeredPlay) {
                clickTriggeredPlay = false;
                return;
            }
            state.videoPlays++;
            if (state.videoPlays > 2 && (step.stepType === "closedResponse" || step.stepType === "openResponse")) {
                appStore.getState().deductListeningScore(10);
                pointLoss.show(state.player.video, 10);
            }
        });

        state.player.video.addEventListener('click', () => {
            state.videoClicks++;
            if (state.videoClicks % 2 === 1 && (step.stepType === "closedResponse" || step.stepType === "openResponse")) {
                clickTriggeredPlay = true;
                appStore.getState().deductListeningScore(15);
                pointLoss.show(state.player.video, 15);
            }
        });
    }

    if (step.simpleVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.simpleVideoUrl);
        state.player = new simpleVideoPlayer({
            videoUrl: currentVideoUrl,
            subtitles: getLocalizedTranslation(step.subtitles, lang),
            containerSelector: '#simple-ivp-container',
            videoStyles: { maxWidth: '100%' },
            subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' }
        });

        window.currentSimpleVideoPlayer = state.player;

        try {
            const videoEl = state.player.video;
            videoEl.muted = false;
            playWhenReady(state.player);
        } catch (e) { }
    }

    if (step.introBackgroundVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.introBackgroundVideoUrl);
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