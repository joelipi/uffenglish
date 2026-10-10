// video-share-download.test.js
// Tests for the desktop download delivery path
// (stories/060-autoplay-share-video, desktop-download follow-up). jsdom has
// no codecs or share sheet: mp4 blobs pass through without touching
// WebCodecs, and the anchor click is spied (jsdom cannot navigate).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ensureMp4Blob,
    downloadVideoBlob,
    deliverVideo,
} from './video-share.web.js';

describe('ensureMp4Blob', () => {
    it('passes an mp4 blob through untouched (no transcode)', async () => {
        const blob = new Blob(['fake-mp4'], { type: 'video/mp4' });
        await expect(ensureMp4Blob(blob, 'lesson.mp4', 'mp4')).resolves.toEqual({
            blob,
            name: 'lesson.mp4',
        });
    });

    it('defaults a missing mp4 filename', async () => {
        const blob = new Blob(['fake-mp4'], { type: 'video/mp4' });
        const out = await ensureMp4Blob(blob, null, 'mp4');
        expect(out).toEqual({ blob, name: 'uffenglish.mp4' });
    });
});

describe('downloadVideoBlob', () => {
    let clickSpy;

    beforeEach(() => {
        vi.useFakeTimers();
        URL.createObjectURL = vi.fn(() => 'blob:fake-url');
        URL.revokeObjectURL = vi.fn();
        clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('clicks a download anchor with the blob URL and filename, then revokes', () => {
        const blob = new Blob(['fake-mp4'], { type: 'video/mp4' });
        expect(downloadVideoBlob(blob, 'my-lesson.mp4')).toBe('my-lesson.mp4');

        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        const anchor = clickSpy.mock.instances[0];
        expect(anchor.getAttribute('href')).toBe('blob:fake-url');
        expect(anchor.download).toBe('my-lesson.mp4');
        // The transient node is removed synchronously after the click.
        expect(document.body.contains(anchor)).toBe(false);

        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });

    it('defaults the filename and warns without a blob', () => {
        const blob = new Blob(['x'], { type: 'video/mp4' });
        expect(downloadVideoBlob(blob, null)).toBe('uffenglish.mp4');
        expect(downloadVideoBlob(null, 'x.mp4')).toBeNull();
    });
});

describe('deliverVideo', () => {
    let clickSpy;

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => 'blob:fake-url');
        URL.revokeObjectURL = vi.fn();
        vi.useFakeTimers();
        clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('downloads on the download target without touching the share sheet', async () => {
        const blob = new Blob(['fake-mp4'], { type: 'video/mp4' });
        const shareSpy = vi.fn().mockRejectedValue(new Error('must not be called'));
        Object.defineProperty(window.navigator, 'share', { value: shareSpy, configurable: true });
        try {
            await expect(deliverVideo({ blob, filename: 'lesson.mp4', fileExtension: 'mp4', target: 'download' }))
                .resolves.toEqual({ delivered: 'download', name: 'lesson.mp4' });
            expect(clickSpy).toHaveBeenCalledTimes(1);
            expect(shareSpy).not.toHaveBeenCalled();
        } finally {
            delete window.navigator.share;
        }
    });

    it('uses the native sheet on the native target (jsdom: sheet unavailable, returns cleanly)', async () => {
        const blob = new Blob(['fake-mp4'], { type: 'video/mp4' });
        await expect(deliverVideo({ blob, filename: 'lesson.mp4', fileExtension: 'mp4', target: 'native' }))
            .resolves.toEqual({ delivered: 'shared', name: 'lesson.mp4' });
        expect(clickSpy).not.toHaveBeenCalled();
    });
});
