// src/components/intro-preload.test.js
// Story 031: the intro <video> must only preload metadata (never the full file),
// so it cannot starve the first lesson video on Windows/Android. The Android
// play() coax that forced a full pull is gone.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../modules/answer/answer-pipeline.js', () => ({
    getIntroContinueHandler: () => null,
}));
vi.mock('../modules/video/video-url.js', () => ({
    getPosterUrl: (slug) => `https://example.test/${slug}.jpg`,
}));
vi.mock('../generated/poster-lqips.js', () => ({
    getPosterLqip: () => null,
}));

import { appStore } from '../modules/store/store.js';
import IncomingVideoWidget from './IncomingVideoWidget.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

const stripComments = (src) =>
    src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('IncomingVideoWidget intro preload — source guards', () => {
    const widget = stripComments(read('src/components/IncomingVideoWidget.jsx'));

    it('no longer branches preload on isIOS', () => {
        expect(widget).not.toContain("isIOS ? 'metadata' : 'auto'");
        expect(widget).not.toContain('isIOS');
    });

    it('signals ready on loadedmetadata', () => {
        expect(widget).toContain('onLoadedMetadata={signalReady}');
    });

    it('no longer calls video.play() in the mount effect', () => {
        expect(widget).not.toContain('video.play()');
    });
});

describe('IncomingVideoWidget intro preload — rendered element', () => {
    let container;
    let root;

    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());

        appStore.getState().setCurrentVideo({
            type: 'intro',
            responseType: 'intro',
            url: 'https://example.test/intro.mp4',
            config: { posterSlug: 'testvideointro' },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(IncomingVideoWidget));
        });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
        appStore.getState().setCurrentVideo(null);
        vi.restoreAllMocks();
    });

    it('renders the intro video with preload="metadata" and anonymous CORS', () => {
        const video = container.querySelector('video');
        expect(video).not.toBeNull();
        expect(video.getAttribute('preload')).toBe('metadata');
        expect(video.getAttribute('crossorigin')).toBe('anonymous');
    });

    it('does not call play() on the intro video', () => {
        expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
});
