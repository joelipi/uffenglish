// src/components/profile/FriendLessonLinksSection.test.js
// Presentational unit tests for the profile friend-challenge card (story 026):
// the embedded concatenated recap above the link, the mount-time HEAD
// availability probe, multiple co-authored entries, legacy entries without a
// video, and the play-time error fallback.
// Rendered with createRoot + act (pattern from src/components/intro-caller-name.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const entryA = () => ({
    courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '', addedAt: iso(Date.now() - HOUR),
});
const entryB = (otherShareCode) => ({
    courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode, addedAt: iso(Date.now() - HOUR),
});

describe('FriendLessonLinksSection', () => {
    let container;
    let root;
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
        vi.unstubAllGlobals();
    });

    const render = async (friendLinks) => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(React.createElement(FriendLessonLinksSection, { friendLinks, lang: 'en' }));
        });
    };

    const videos = () => container.querySelectorAll('[data-testid="friend-lesson-video"]');
    const links = () => container.querySelectorAll('[data-testid="friend-lesson-link"]');

    it('renders the A recap video with the first-segment poster, above the link, and probes it', async () => {
        await render({ 'friend:a': entryA() });

        expect(videos()).toHaveLength(1);
        const video = videos()[0];
        expect(video.getAttribute('src')).toBe('https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4');
        expect(video.getAttribute('poster')).toBe('https://r2.ultrafastfluency.com/videos/ab12-friend-a-response-01.jpg');
        expect(video.controls).toBe(true);
        expect(video.playsInline).toBe(true);
        expect(video.getAttribute('preload')).toBe('none');

        expect(links()).toHaveLength(1);
        expect(links()[0].getAttribute('href')).toBe('https://ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12');

        // Video precedes the anchor in document order.
        const ordered = container.querySelectorAll('[data-testid="friend-lesson-video"], [data-testid="friend-lesson-link"]');
        expect(ordered[0].getAttribute('data-testid')).toBe('friend-lesson-video');
        expect(ordered[1].getAttribute('data-testid')).toBe('friend-lesson-link');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4',
            { method: 'HEAD' }
        );
    });

    it('renders a co-authored B recap keyed and poster-ed by the co-participant, link still the creator', async () => {
        await render({ 'friend:b:cd34': entryB('cd34') });

        expect(videos()).toHaveLength(1);
        const video = videos()[0];
        expect(video.getAttribute('src')).toBe('https://r2.ultrafastfluency.com/videos/ab12-cd34-friend-b-complete.mp4');
        expect(video.getAttribute('poster')).toBe('https://r2.ultrafastfluency.com/videos/cd34-friend-a-response-01.jpg');

        expect(links()[0].getAttribute('href')).toBe('https://ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12');
    });

    it('hides the video but keeps the link when the probe returns a non-ok response', async () => {
        fetchMock.mockResolvedValue({ ok: false });
        await render({ 'friend:a': entryA() });

        expect(videos()).toHaveLength(0);
        expect(links()).toHaveLength(1);
    });

    it('hides the video but keeps the link when the probe rejects', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        await render({ 'friend:a': entryA() });

        expect(videos()).toHaveLength(0);
        expect(links()).toHaveLength(1);
    });

    it('hides the video but keeps the link when the video errors after a successful probe', async () => {
        await render({ 'friend:a': entryA() });

        const video = videos()[0];
        act(() => {
            video.dispatchEvent(new Event('error'));
        });

        expect(videos()).toHaveLength(0);
        expect(links()).toHaveLength(1);
    });

    it('remounts and re-probes when the same entry is re-exported with a newer addedAt', async () => {
        fetchMock.mockResolvedValue({ ok: false });
        await render({ 'friend:a': entryA() });
        expect(videos()).toHaveLength(0);

        // Same course/lesson/other, newer addedAt -> new card key -> remount + re-probe.
        fetchMock.mockResolvedValue({ ok: true });
        const newer = { ...entryA(), addedAt: iso(Date.now()) };
        await act(async () => {
            root.render(React.createElement(FriendLessonLinksSection, { friendLinks: { 'friend:a': newer }, lang: 'en' }));
        });

        expect(videos()).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('renders a legacy entry with no lessonId as link-only and never probes', async () => {
        await render({ friend: { courseId: 'friend', shareCode: 'ab12', addedAt: iso(Date.now() - HOUR) } });

        expect(videos()).toHaveLength(0);
        expect(links()).toHaveLength(1);
        expect(container.querySelector('[data-testid="friend-lesson-links"]')).not.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renders two cards for two co-authored B entries with two friends', async () => {
        await render({
            'friend:b:cd34': entryB('cd34'),
            'friend:b:ef56': entryB('ef56'),
        });

        expect(videos()).toHaveLength(2);
        expect(links()).toHaveLength(2);
    });

    it('drops a card whose 48h window has elapsed', async () => {
        await render({
            'friend:a': entryA(),
            'friend:b:cd34': { ...entryB('cd34'), addedAt: iso(Date.now() - 48 * HOUR) },
        });

        expect(videos()).toHaveLength(1);
        expect(links()).toHaveLength(1);
    });

    it('renders nothing for empty / malformed friendLinks', async () => {
        for (const friendLinks of [{}, null, [], 'x', undefined]) {
            await render(friendLinks);
            expect(container.querySelector('[data-testid="friend-lesson-links"]')).toBeNull();
            expect(videos()).toHaveLength(0);
            expect(links()).toHaveLength(0);
        }
    });
});
