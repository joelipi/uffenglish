import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ConversationCarousel from './ConversationCarousel.jsx';
import { getPosterUrl, getVideoUrl } from '../../modules/video/video-url.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIDEOS = ['A', 'B', 'C'].map((slug) => ({
    slug,
    videoUrl: getVideoUrl(slug),
    posterUrl: getPosterUrl(slug),
}));

describe('ConversationCarousel', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const render = (props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(ConversationCarousel, { videos: VIDEOS, ...props }));
        });
    };

    const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);
    const videos = () => container.querySelectorAll('video');
    const posters = () => container.querySelectorAll('img');

    it('renders posters first with no video elements', () => {
        render();
        expect(q('showcase-carousel')).not.toBeNull();
        expect(q('showcase-heading').textContent).toBe('See what a conversation looks like');
        expect(posters()).toHaveLength(3);
        expect(videos()).toHaveLength(0);
        for (const v of VIDEOS) {
            const poster = q(`showcase-poster-${v.slug}`);
            expect(poster).not.toBeNull();
            expect(poster.tagName).toBe('IMG');
            expect(poster.getAttribute('src')).toBe(v.posterUrl);
            expect(poster.getAttribute('loading')).toBe('lazy');
            expect(q(`showcase-play-${v.slug}`)).not.toBeNull();
        }
        expect(q('showcase-track').style.transform).toBe('translateX(-0%)');
    });

    it('mounts exactly one video for the slide whose play was pressed', () => {
        render();
        act(() => { q('showcase-play-B').click(); });
        expect(videos()).toHaveLength(1);
        const video = q('showcase-video-B');
        expect(video).not.toBeNull();
        expect(video.getAttribute('src')).toBe(VIDEOS[1].videoUrl);
        expect(video.getAttribute('poster')).toBe(VIDEOS[1].posterUrl);
        expect(q('showcase-poster-B')).toBeNull();
    });

    it('replaces the mounted video when play is pressed on another slide', () => {
        render();
        act(() => { q('showcase-play-B').click(); });
        act(() => { q('showcase-play-A').click(); });
        expect(videos()).toHaveLength(1);
        expect(q('showcase-video-A').getAttribute('src')).toBe(VIDEOS[0].videoUrl);
    });

    it('advances the track and unmounts a playing video on next', () => {
        render();
        act(() => { q('showcase-play-A').click(); });
        expect(videos()).toHaveLength(1);
        act(() => { q('showcase-next').click(); });
        expect(q('showcase-track').style.transform).toBe('translateX(-100%)');
        expect(videos()).toHaveLength(0);
        expect(q('showcase-prev').hasAttribute('disabled')).toBe(false);
    });

    it('disables prev at the first slide and next at the last', () => {
        render();
        expect(q('showcase-prev').hasAttribute('disabled')).toBe(true);
        act(() => { q('showcase-next').click(); });
        act(() => { q('showcase-next').click(); });
        expect(q('showcase-next').hasAttribute('disabled')).toBe(true);
        expect(q('showcase-prev').hasAttribute('disabled')).toBe(false);
    });

    it('renders nothing when there are no videos', () => {
        render({ videos: [] });
        expect(q('showcase-carousel')).toBeNull();
    });

    it('localizes the heading and play label', () => {
        render({ lang: 'es' });
        expect(q('showcase-heading').textContent).toBe('Mira cómo es una conversación');
        expect(q('showcase-play-A').getAttribute('aria-label')).toBe('Reproducir video');
    });
});
