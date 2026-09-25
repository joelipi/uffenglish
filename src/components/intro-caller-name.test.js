// src/components/intro-caller-name.test.js
// Story 013: the lesson-intro overlay must not show a hardcoded caller
// name/title ("Joe Walsh" / "English Coach, UFF"). The block is intentionally
// left commented out in the widget, so the source guards strip comments before
// asserting absence. Comment-stripping is safe here: these are bare
// identifiers, not URL/scheme assertions (docs/learnings.md).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Keep the widget import light: the intro overlay under test only needs these
// deps, and the real answer-pipeline pulls in the full app graph.
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

describe('intro caller name/title — source guards', () => {
    const widget = stripComments(read('src/components/IncomingVideoWidget.jsx'));
    const loader = stripComments(read('src/modules/video/video-loader.web.js'));

    it('IncomingVideoWidget.jsx no longer contains the hardcoded identity', () => {
        expect(widget).not.toContain('Joe Walsh');
        expect(widget).not.toContain('English Coach, UFF');
    });

    it('IncomingVideoWidget.jsx still renders the INCOMING VIDEO top label', () => {
        expect(widget).toContain('INCOMING VIDEO');
    });

    it('video-loader.web.js no longer injects the hardcoded identity', () => {
        expect(loader).not.toContain('Joe Walsh');
        expect(loader).not.toContain('English Coach, UFF');
    });

    it('video-loader.web.js intro config still sets title and subtitle', () => {
        expect(loader).toMatch(/title:\s*Strings\.get\('incoming_video'/);
        expect(loader).toMatch(/subtitle:\s*Strings\.getBilingual\('video_incoming'/);
    });
});

describe('intro caller name/title — rendered overlay', () => {
    let container;
    let root;

    const renderIntro = (config) => {
        appStore.getState().setCurrentVideo({
            type: 'intro',
            responseType: 'intro',
            url: 'https://example.test/intro.mp4',
            config,
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(IncomingVideoWidget));
        });
    };

    // jsdom does not implement media loading; stub it so effects don't log.
    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
        appStore.getState().setCurrentVideo(null);
        vi.restoreAllMocks();
    });

    it('renders no caller name/title when config supplies name/role', () => {
        renderIntro({
            title: 'INCOMING VIDEO',
            subtitle: { lang: 'en', localized: 'Incoming video' },
            name: 'Joe Walsh',
            role: 'English Coach, UFF',
        });

        expect(container.querySelector('.intro-caller-name')).toBeNull();
        expect(container.querySelector('.intro-caller-title')).toBeNull();
        expect(container.querySelector('.intro-notification-bottom')).toBeNull();
    });

    it('renders no caller name/title or fallback text when config omits them', () => {
        renderIntro({
            title: 'INCOMING VIDEO',
            subtitle: { lang: 'en', localized: 'Incoming video' },
        });

        expect(container.querySelector('.intro-caller-name')).toBeNull();
        expect(container.querySelector('.intro-caller-title')).toBeNull();
        expect(container.textContent).not.toContain('Joe Walsh');
        expect(container.textContent).not.toContain('English Coach, UFF');
    });

    it('still renders the INCOMING VIDEO label and localized subtitle', () => {
        renderIntro({
            subtitle: { lang: 'es', localized: 'Vídeo entrante' },
        });

        const title = container.querySelector('.intro-call-title span');
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('INCOMING VIDEO');

        const subtitle = container.querySelector('.intro-call-subtitle span');
        expect(subtitle).not.toBeNull();
        expect(subtitle.textContent).toBe('Vídeo entrante');
    });
});
