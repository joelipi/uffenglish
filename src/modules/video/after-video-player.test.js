// after-video-player.test.js
// Behavioral tests for the display-only after-video controller
// (stories/060-autoplay-share-video) with fully mocked media: jsdom has no
// codecs, so video readiness, fetch bytes and the AudioContext are stubbed.
// Real audible playback stays a manual device check (see story Notes).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appStore } from '../store/store.js';
import * as player from './after-video-player.web.js';

const m = player;

let playCalls;
let pauseCalls;
let fetchedUrls;
let fetchImpl;
let fakeSources;

function makeFakeAudioContext() {
    return {
        state: 'running',
        currentTime: 0,
        destination: { label: 'speakers' },
        decodeAudioData: vi.fn(async () => ({ label: 'decoded-buffer' })),
        createBufferSource: vi.fn(() => {
            const source = {
                buffer: null,
                loop: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
            };
            fakeSources.push(source);
            return source;
        }),
    };
}

function installMediaMocks() {
    playCalls = 0;
    pauseCalls = 0;
    fetchedUrls = [];
    fakeSources = [];
    fetchImpl = async (url) => {
        fetchedUrls.push(String(url));
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    vi.stubGlobal('fetch', (...args) => fetchImpl(...args));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    window.HTMLMediaElement.prototype.play = vi.fn(async function () {
        playCalls += 1;
        return undefined;
    });
    window.HTMLMediaElement.prototype.pause = vi.fn(function () {
        pauseCalls += 1;
    });
    // jsdom video elements never fire canplay on their own; the helper below
    // fires it for the newest tail element once the controller is listening.
    window.HTMLMediaElement.prototype.load = vi.fn(function () {});
}

function fireCanPlay() {
    const videos = [...document.querySelectorAll('video')];
    const el = videos[videos.length - 1];
    expect(el).toBeTruthy();
    el.dispatchEvent(new window.Event('canplay'));
}

function makeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    document.body.appendChild(canvas);
    return canvas;
}

describe('after-video-player.web.js', () => {
    beforeEach(() => {
        installMediaMocks();
        m.stopAfterVideoLoop();
        appStore.getState().setAfterVideoActive(null);
    });

    afterEach(async () => {
        m.stopAfterVideoLoop();
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        appStore.getState().setAfterVideoActive(null);
    });

    it('starts an audible loop: muted element, looping buffer, store flag, one #afterVideo', async () => {
        const canvas = makeCanvas();
        const audioContext = makeFakeAudioContext();
        const started = m.startAfterVideoLoop({
            displayCanvas: canvas,
            base: 'aftersuccess',
            guestLang: 'es',
            profileLang: null,
            audioContext,
        });
        await Promise.resolve();
        fireCanPlay();
        await expect(started).resolves.toBe('aftersuccess');

        // Language-ordered candidates were tried in order.
        expect(fetchedUrls[0]).toMatch(/aftersuccess-es\.mp4$/);
        const el = document.getElementById('afterVideo');
        expect(el).not.toBeNull();
        expect(document.querySelectorAll('#afterVideo')).toHaveLength(1);
        expect(el.muted).toBe(true);
        expect(el.loop).toBe(true);
        expect(playCalls).toBe(1);
        // Audible path: decoded buffer looped to speakers, element stays muted.
        expect(audioContext.decodeAudioData).toHaveBeenCalled();
        expect(fakeSources).toHaveLength(1);
        expect(fakeSources[0].buffer).toEqual({ label: 'decoded-buffer' });
        expect(fakeSources[0].loop).toBe(true);
        expect(fakeSources[0].start).toHaveBeenCalled();
        expect(appStore.getState().afterVideoActive).toBe('aftersuccess');
        expect(m.getActiveAfterVideoBase()).toBe('aftersuccess');
    });

    it('falls through candidates in order and throws when all fail', async () => {
        fetchImpl = async (url) => {
            fetchedUrls.push(String(url));
            return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
        };
        const canvas = makeCanvas();
        const started = m.startAfterVideoLoop({
            displayCanvas: canvas,
            base: 'aftersuccess',
            guestLang: 'es',
            profileLang: null,
            audioContext: makeFakeAudioContext(),
        });
        // Fetch rejects for every candidate, so the fall-through needs no
        // video events at all — the audio half alone drives each failure.
        await expect(started).rejects.toThrow();
        expect(fetchedUrls).toHaveLength(3);
        expect(fetchedUrls.map((u) => u.split('/').pop())).toEqual([
            'aftersuccess-es.mp4',
            'aftersuccess-en.mp4',
            'aftersuccess.mp4',
        ]);
        expect(document.getElementById('afterVideo')).toBeNull();
        expect(appStore.getState().afterVideoActive).toBeNull();
    });

    it('toggles pause/resume on tap: both element and buffer stop and restart', async () => {
        const canvas = makeCanvas();
        const started = m.startAfterVideoLoop({
            displayCanvas: canvas,
            base: 'aftersuccess',
            guestLang: 'en',
            profileLang: null,
            audioContext: makeFakeAudioContext(),
        });
        await Promise.resolve();
        fireCanPlay();
        await started;

        expect(m.isAfterVideoPaused()).toBe(false);
        await expect(m.toggleAfterVideo()).resolves.toBe(true);
        expect(m.isAfterVideoPaused()).toBe(true);
        expect(pauseCalls).toBe(1);
        expect(fakeSources[0].stop).toHaveBeenCalled();
        await expect(m.toggleAfterVideo()).resolves.toBe(false);
        expect(m.isAfterVideoPaused()).toBe(false);
        expect(playCalls).toBe(2);
        expect(fakeSources).toHaveLength(2);
    });

    it('toggle with no active loop is a safe no-op', async () => {
        await expect(m.toggleAfterVideo()).resolves.toBe(false);
        expect(m.isAfterVideoPaused()).toBe(false);
    });

    it('swap builds the replacement before tearing down, keeping the old on failure', async () => {
        const canvas = makeCanvas();
        const first = m.startAfterVideoLoop({
            displayCanvas: canvas,
            base: 'aftersuccess',
            guestLang: 'en',
            profileLang: null,
            audioContext: makeFakeAudioContext(),
        });
        await Promise.resolve();
        fireCanPlay();
        await first;
        const firstEl = document.getElementById('afterVideo');

        // Swap target 404s on every candidate: the old loop must survive.
        fetchImpl = async (url) => {
            fetchedUrls.push(String(url));
            if (String(url).includes('aftershare')) {
                return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
            }
            return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
        };
        const swapAttempt = m.swapAfterVideoLoop('aftershare', { guestLang: 'en', profileLang: null });
        // Every swap candidate 404s on fetch, so no video events are needed.
        await expect(swapAttempt).resolves.toBe('aftersuccess');
        expect(document.getElementById('afterVideo')).toBe(firstEl);
        expect(appStore.getState().afterVideoActive).toBe('aftersuccess');
    });

    it('swap with no active loop is a safe no-op returning null', async () => {
        await expect(m.swapAfterVideoLoop('aftershare', { guestLang: 'en' })).resolves.toBeNull();
    });

    it('stop revokes the element and clears the store flag', async () => {
        const canvas = makeCanvas();
        const started = m.startAfterVideoLoop({
            displayCanvas: canvas,
            base: 'aftersuccess',
            guestLang: 'en',
            profileLang: null,
            audioContext: makeFakeAudioContext(),
        });
        await Promise.resolve();
        fireCanPlay();
        await started;
        m.stopAfterVideoLoop();
        expect(document.getElementById('afterVideo')).toBeNull();
        expect(appStore.getState().afterVideoActive).toBeNull();
        expect(m.getActiveAfterVideoBase()).toBeNull();
    });

    it('createSharedAudioContext returns null with no browser AudioContext', () => {
        expect(window.AudioContext).toBeUndefined();
        expect(m.createSharedAudioContext()).toBeNull();
        expect(m.createSharedAudioContext(null)).toBeNull();
    });

    it('createSharedAudioContext reuses a running context and resumes a suspended one', () => {
        const running = { state: 'running', resume: vi.fn() };
        expect(m.createSharedAudioContext(running)).toBe(running);
        expect(running.resume).not.toHaveBeenCalled();
        let resumed = false;
        const suspended = { state: 'suspended', resume: vi.fn(async () => { resumed = true; }) };
        expect(m.createSharedAudioContext(suspended)).toBe(suspended);
        expect(suspended.resume).toHaveBeenCalled();
        expect(resumed).toBe(true);
    });
});
