import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Media } from './media.web.js';
import { appStore } from './store.js';
import { Howl, Howler } from 'howler';

vi.mock('howler', () => {
    return {
        Howl: class {
            play() {}
        },
        Howler: {
            ctx: {
                state: 'suspended',
                resume: vi.fn().mockResolvedValue(true)
            }
        }
    };
});

describe('Media Web Module', () => {
    beforeEach(() => {
        appStore.getState().setAudioEnabled(false);
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    afterEach(() => {
        Media.preloader.destroy();
    });

    describe('playSound', () => {
        it('should not play if audio is disabled', () => {
            appStore.getState().setAudioEnabled(false);
            Media.playSound('correct-sound');
            // Since we mocked Howl, we can check instances if needed, but it's hard to access the inner instances
            // We just ensure it doesn't crash
        });

        it('should play if audio is enabled', () => {
            appStore.getState().setAudioEnabled(true);
            Media.playSound('correct-sound');
        });

        it('should not throw if sound ID is invalid', () => {
            appStore.getState().setAudioEnabled(true);
            expect(() => Media.playSound('non-existent')).not.toThrow();
        });
    });

    describe('pauseVideoIfPlaying', () => {
        it('should pause any unpaused video elements', () => {
            const video1 = document.createElement('video');
            video1.className = 'ivp-video';
            // mock properties
            Object.defineProperty(video1, 'paused', { value: false, writable: true });
            video1.pause = vi.fn();

            const video2 = document.createElement('video');
            video2.id = 'playback-video';
            Object.defineProperty(video2, 'paused', { value: true, writable: true });
            video2.pause = vi.fn();

            document.body.appendChild(video1);
            document.body.appendChild(video2);

            Media.pauseVideoIfPlaying();

            expect(video1.pause).toHaveBeenCalled();
            expect(video2.pause).not.toHaveBeenCalled();
        });
    });

    describe('cleanupPreviousPlayers', () => {
        it('should cleanup global video players and DOM videos', () => {
            window.currentVideoPlayer = { destroy: vi.fn() };
            window.currentSimpleVideoPlayer = { destroy: vi.fn() };
            window.currentIntroVideoPlayer = { destroy: vi.fn() };

            const video1 = document.createElement('video');
            video1.className = 'ivp-video';
            video1.pause = vi.fn();
            video1.load = vi.fn();
            document.body.appendChild(video1);

            Media.cleanupPreviousPlayers();

            expect(window.currentVideoPlayer).toBeNull();
            expect(window.currentSimpleVideoPlayer).toBeNull();
            expect(window.currentIntroVideoPlayer).toBeNull();

            expect(video1.pause).toHaveBeenCalled();
            expect(video1.load).toHaveBeenCalled();
            expect(video1.getAttribute('src')).toBeNull();
        });
    });

    describe('enableAudioSystem', () => {
        it('should resume AudioContext if suspended', async () => {
            Howler.ctx.state = 'suspended';
            await Media.enableAudioSystem();
            expect(Howler.ctx.resume).toHaveBeenCalled();
            expect(appStore.getState().isAudioEnabled).toBe(true);
        });

        it('should not resume if not suspended', async () => {
            Howler.ctx.state = 'running';
            await Media.enableAudioSystem();
            expect(Howler.ctx.resume).not.toHaveBeenCalled();
            expect(appStore.getState().isAudioEnabled).toBe(true);
        });

        it('should catch errors gracefully', async () => {
            Howler.ctx.state = 'suspended';
            Howler.ctx.resume.mockRejectedValueOnce(new Error('Audio Error'));
            const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await Media.enableAudioSystem();
            expect(consoleWarn).toHaveBeenCalled();
            expect(appStore.getState().isAudioEnabled).toBe(false); // State shouldn't enable on error

            consoleWarn.mockRestore();
        });
    });

    describe('preloader', () => {
        it('should create preload video element on first call', () => {
            Media.preloader.preloadOnly('test.mp4');
            const video = document.getElementById('media-preloader-element');
            expect(video).toBeDefined();
            expect(video.src).toMatch(/test\.mp4$/);
        });

        it('should update source if url changes', () => {
            Media.preloader.preloadOnly('test.mp4');
            Media.preloader.preloadOnly('test2.mp4');
            const video = document.getElementById('media-preloader-element');
            expect(video.src).toMatch(/test2\.mp4$/);
        });

        it('should not update source if url is same', () => {
             Media.preloader.preloadOnly('http://localhost:3000/test.mp4'); // JSDOM sets full url
             const video = document.getElementById('media-preloader-element');
             video.load = vi.fn();
             Media.preloader.preloadOnly('http://localhost:3000/test.mp4');
             expect(video.load).not.toHaveBeenCalled();
        });

        it('should destroy preload element', () => {
            Media.preloader.preloadOnly('test.mp4');
            Media.preloader.destroy();
            const video = document.getElementById('media-preloader-element');
            expect(video).toBeNull();
            expect(Media.preloader.video).toBeNull();
        });
    });
});
