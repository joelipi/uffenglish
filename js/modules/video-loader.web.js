// --- modules/video-loader.web.js ---
// Web-only module — reads window.preloadedMedia for cache-hit video URLs.
// React Native replaces this with video-loader.native.js.
// This module resolves video URLs and writes video config to the Zustand store.
// The actual player instantiation is handled by the React wrappers
// (InteractiveVideoWrapper, SimpleVideoWrapper, IntroVideoWrapper)
// which subscribe to the store and mount/destroy player instances.

import { appStore } from './store.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';

const FIREBASE_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';

function resolveVideoUrl(slug) {
    return (window.preloadedMedia && window.preloadedMedia[slug])
        ? window.preloadedMedia[slug]
        : `${FIREBASE_BASE}${slug}.mp4`;
}

export function loadVideoForStep(step, _state, lang) {
    // Clear any previous video state before loading the new step
    appStore.getState().setCurrentVideo(null);

    if (step.videoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.videoUrl);
        appStore.getState().setCurrentVideo({
            type: 'interactive',
            stepType: step.stepType,
            url: currentVideoUrl,
            config: {
                cue: step.cue,
                videoStyles: { maxWidth: '100%' },
                subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            }
        });
    }

    if (step.simpleVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.simpleVideoUrl);
        appStore.getState().setCurrentVideo({
            type: 'simple',
            stepType: step.stepType,
            url: currentVideoUrl,
            config: {
                subtitles: getLocalizedTranslation(step.subtitles, lang),
                videoStyles: { maxWidth: '100%' },
                subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            }
        });
    }

    if (step.introBackgroundVideoUrl) {
        const currentVideoUrl = resolveVideoUrl(step.introBackgroundVideoUrl);
        appStore.getState().setCurrentVideo({
            type: 'intro',
            stepType: step.stepType,
            url: currentVideoUrl,
            config: {
                title: Strings.get('incoming_video', lang) || 'INCOMING VIDEO',
                subtitle: Strings.get('video_incoming', lang) || 'VIDEO ENTRANTE',
                name: 'Joe Walsh',
                role: Strings.get('english_coach', lang) || 'English Coach, UFF',
                alertText: Strings.get('press_webcam', lang) || 'Press the webcam button below. Oprime el botón de cámara abajo.'
            }
        });
    }
}
