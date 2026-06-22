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

    // Default: no intro video to wait for. Only set to false below when
    // this step has an introBackgroundVideoUrl that must load first.
    appStore.getState().setIntroVideoReady(true);

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
        // Keep the Preloader overlay until IncomingVideoWidget confirms the
        // intro background video is decoded and painted (via onLoadedData).
        appStore.getState().setIntroVideoReady(false);
        appStore.getState().setCurrentVideo({
            type: 'intro',
            responseType: step.responseType,
            url: currentVideoUrl,
            config: {
                title: Strings.get('incoming_video', 'en') || 'INCOMING VIDEO',
                subtitle: Strings.getBilingual('video_incoming', lang),
                name: 'Joe Walsh',
                role: 'English Coach, UFF',
                alertText: Strings.getBilingual('press_webcam', lang),
            }
        });
    }
}
