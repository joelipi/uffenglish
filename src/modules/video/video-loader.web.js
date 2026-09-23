// --- modules/video-loader.web.js ---
// Web-only module — resolves video URLs and writes video config to the Zustand store.
// React Native replaces this with video-loader.native.js.
// This module resolves video URLs and writes video config to the Zustand store.
// The actual player instantiation is handled by the React wrappers
// (InteractiveVideoWrapper, SimpleVideoWrapper, IntroVideoWrapper)
// which subscribe to the store and mount/destroy player instances.

import { appStore } from '../store/store.js';
import Strings from '../../data/strings.js';
import { getLocalizedTranslation } from '../utils/utils.js';
import { getVideoUrl } from './video-url.js';

export function loadVideoForStep(step, _state, lang) {
    // Clear any previous video state before loading the new step
    appStore.getState().setCurrentVideo(null);

    // Default: no intro poster/video to wait for. Gate Preloader on poster
    // (lessonId jpg + LQIP) for zero-ms rectangle guarantee; video warms
    // hidden behind poster for next step.
    appStore.getState().setIntroVideoReady(true);
    appStore.getState().setIntroPosterReady(true);

    if (step.interactiveVideoUrl) {
        const currentVideoUrl = getVideoUrl(step.interactiveVideoUrl);
        appStore.getState().setCurrentVideo({
            type: 'interactive',
            responseType: step.responseType,
            url: currentVideoUrl,
            config: {
                cue: step.cue,
                videoStyles: { maxWidth: '100%' },
                subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            }
        });
    }

    if (step.simpleVideoUrl) {
        const currentVideoUrl = getVideoUrl(step.simpleVideoUrl);
        appStore.getState().setCurrentVideo({
            type: 'simple',
            responseType: step.responseType,
            url: currentVideoUrl,
            config: {
                subtitles: getLocalizedTranslation(step.subtitles, lang),
                videoStyles: { maxWidth: '100%' },
                subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            }
        });
    }

    if (step.introBackgroundVideoUrl) {
        const currentVideoUrl = getVideoUrl(step.introBackgroundVideoUrl);
        // Gate Preloader on poster (LQIP + jpg) for zero-ms guarantee.
        // Video still warms hidden behind poster for next step.
        appStore.getState().setIntroPosterReady(false);
        appStore.getState().setIntroVideoReady(false);
        appStore.getState().setCurrentVideo({
            type: 'intro',
            responseType: step.responseType,
            url: currentVideoUrl,
            config: {
                title: Strings.get('incoming_video', lang) || 'INCOMING VIDEO',
                subtitle: Strings.getBilingual('video_incoming', lang),
                name: 'Joe Walsh',
                role: 'English Coach, UFF',
                alertText: Strings.getBilingual('press_webcam', lang),
                // Slug-keyed R2 poster (assets/videos/<slug>.jpg); the widget
                // resolves it via getPosterUrl/getPosterLqip.
                posterSlug: step.introBackgroundVideoUrl,
            }
        });
    }
}
