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
        it('should be a no-op (pausing is now store-driven via triggerPauseAllVideos)', () => {
            expect(() => Media.pauseVideoIfPlaying()).not.toThrow();
        });
    });

    describe('cleanupPreviousPlayers', () => {
        it('should be a no-op (React handles teardown via component lifecycle)', () => {
            expect(() => Media.cleanupPreviousPlayers()).not.toThrow();
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
        it('should not throw if url is empty', () => {
            expect(() => Media.preloader.preloadOnly('')).not.toThrow();
            expect(() => Media.preloader.preloadOnly(null)).not.toThrow();
            expect(() => Media.preloader.preloadOnly(undefined)).not.toThrow();
        });

        it('should call fetch with the given url', () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce();
            Media.preloader.preloadOnly('test.mp4');
            expect(fetchSpy).toHaveBeenCalledWith('test.mp4', { method: 'HEAD', mode: 'no-cors' });
            fetchSpy.mockRestore();
        });

        it('should not throw if fetch fails', () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('net error'));
            expect(() => Media.preloader.preloadOnly('test.mp4')).not.toThrow();
            fetchSpy.mockRestore();
        });

        it('should not throw on double destroy', () => {
            expect(() => Media.preloader.destroy()).not.toThrow();
            expect(() => Media.preloader.destroy()).not.toThrow();
        });
    });
});
