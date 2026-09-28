import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    installStaleChunkReload,
    isStaleChunkReloadPending,
    STALE_CHUNK_RELOAD_COUNT_KEY,
    MAX_STALE_CHUNK_RELOADS,
} from './stale-chunk-reload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const MAIN_PATH = path.join(ROOT, 'src/main.jsx');
const SUCCESS_BUTTONS_PATH = path.join(ROOT, 'src/components/widgets/SuccessButtons.jsx');
const PRODUCT_DOC_PATH = path.join(ROOT, 'docs/product.md');

function createFakeWin(initial = {}) {
    const store = new Map(Object.entries(initial));
    const sessionStorage = {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, value);
        }),
    };
    return {
        addEventListener: vi.fn(),
        sessionStorage,
        location: { reload: vi.fn() },
        store,
    };
}

function installedHandler(win, initial) {
    const fakeWin = win || createFakeWin(initial);
    const handler = installStaleChunkReload(fakeWin);
    return { fakeWin, handler };
}

describe('stale-chunk-reload', () => {
    it('registers a vite:preloadError listener during installation', () => {
        const { fakeWin } = installedHandler();
        expect(fakeWin.addEventListener).toHaveBeenCalledWith('vite:preloadError', expect.any(Function));
    });

    it('reloads once and records count 1 when the count is empty', () => {
        const { fakeWin, handler } = installedHandler();
        handler();

        expect(fakeWin.sessionStorage.getItem).toHaveBeenCalledWith(STALE_CHUNK_RELOAD_COUNT_KEY);
        expect(fakeWin.sessionStorage.setItem).toHaveBeenCalledWith(STALE_CHUNK_RELOAD_COUNT_KEY, '1');
        expect(fakeWin.location.reload).toHaveBeenCalledTimes(1);
        expect(isStaleChunkReloadPending(fakeWin)).toBe(true);
    });

    it('reloads a second time and records count 2 when the count is 1', () => {
        const { fakeWin, handler } = installedHandler(null, { [STALE_CHUNK_RELOAD_COUNT_KEY]: '1' });
        handler();

        expect(fakeWin.sessionStorage.setItem).toHaveBeenCalledWith(STALE_CHUNK_RELOAD_COUNT_KEY, '2');
        expect(fakeWin.location.reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload when the count has reached the cap', () => {
        const { fakeWin, handler } = installedHandler(null, {
            [STALE_CHUNK_RELOAD_COUNT_KEY]: String(MAX_STALE_CHUNK_RELOADS),
        });
        handler();

        expect(fakeWin.location.reload).not.toHaveBeenCalled();
        expect(fakeWin.sessionStorage.setItem).not.toHaveBeenCalled();
        expect(fakeWin.store.get(STALE_CHUNK_RELOAD_COUNT_KEY)).toBe('2');
        expect(fakeWin.__uffStaleChunkReloading).toBeUndefined();
        expect(isStaleChunkReloadPending(fakeWin)).toBe(false);
    });

    it('treats a non-numeric count as 0 and reloads', () => {
        const { fakeWin, handler } = installedHandler(null, {
            [STALE_CHUNK_RELOAD_COUNT_KEY]: 'not-a-number',
        });
        handler();

        expect(fakeWin.sessionStorage.setItem).toHaveBeenCalledWith(STALE_CHUNK_RELOAD_COUNT_KEY, '1');
        expect(fakeWin.location.reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload when sessionStorage is absent', () => {
        const fakeWin = { addEventListener: vi.fn(), location: { reload: vi.fn() } };
        const handler = installStaleChunkReload(fakeWin);
        handler();

        expect(fakeWin.location.reload).not.toHaveBeenCalled();
        expect(isStaleChunkReloadPending(fakeWin)).toBe(false);
    });

    it('does not reload when the sessionStorage getter throws', () => {
        const fakeWin = { addEventListener: vi.fn(), location: { reload: vi.fn() } };
        Object.defineProperty(fakeWin, 'sessionStorage', {
            get() {
                throw new Error('sessionStorage denied');
            },
        });
        const handler = installStaleChunkReload(fakeWin);
        handler();

        expect(fakeWin.location.reload).not.toHaveBeenCalled();
        expect(fakeWin.__uffStaleChunkReloading).toBeUndefined();
    });

    it('does not reload when reading the stored count throws', () => {
        const { fakeWin, handler } = installedHandler();
        fakeWin.sessionStorage.getItem.mockImplementation(() => {
            throw new Error('read denied');
        });
        handler();

        expect(fakeWin.location.reload).not.toHaveBeenCalled();
        expect(fakeWin.__uffStaleChunkReloading).toBeUndefined();
    });

    it('does not reload and sets no flag when setItem throws', () => {
        const { fakeWin, handler } = installedHandler();
        fakeWin.sessionStorage.setItem.mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        handler();

        expect(fakeWin.location.reload).not.toHaveBeenCalled();
        expect(fakeWin.__uffStaleChunkReloading).toBeUndefined();
        expect(isStaleChunkReloadPending(fakeWin)).toBe(false);
    });

    it('reports no pending reload on a fresh win', () => {
        const fakeWin = createFakeWin();
        expect(isStaleChunkReloadPending(fakeWin)).toBe(false);
    });

    it('works with the default window argument without throwing', () => {
        expect(() => installStaleChunkReload()).not.toThrow();
        expect(() => isStaleChunkReloadPending()).not.toThrow();
    });
});

describe('stale-chunk-reload wiring (src/main.jsx)', () => {
    const source = readFileSync(MAIN_PATH, 'utf8');

    it('imports installStaleChunkReload from the module', () => {
        expect(source).toMatch(/import \{ installStaleChunkReload \} from '\.\/modules\/utils\/stale-chunk-reload\.js'/);
    });

    it('installs the listener before createRoot is called', () => {
        const installIndex = source.indexOf('installStaleChunkReload()');
        const createRootIndex = source.indexOf('createRoot(');
        expect(installIndex).toBeGreaterThan(-1);
        expect(createRootIndex).toBeGreaterThan(-1);
        expect(installIndex).toBeLessThan(createRootIndex);
    });
});

describe('stale-chunk-reload wiring (src/components/widgets/SuccessButtons.jsx)', () => {
    const source = readFileSync(SUCCESS_BUTTONS_PATH, 'utf8');

    it('imports isStaleChunkReloadPending from the module', () => {
        expect(source).toMatch(/import \{[^}]*isStaleChunkReloadPending[^}]*\} from '\.\.\/\.\.\/modules\/utils\/stale-chunk-reload\.js'/);
    });

    it('returns early before the failure alert when a reload is pending', () => {
        const catchIndex = source.indexOf('catch (err)');
        const pendingIndex = source.indexOf('isStaleChunkReloadPending()');
        const alertIndex = source.indexOf('alert(');
        expect(catchIndex).toBeGreaterThan(-1);
        expect(pendingIndex).toBeGreaterThan(catchIndex);
        expect(alertIndex).toBeGreaterThan(pendingIndex);
    });
});

describe('stale-chunk-reload documentation', () => {
    const product = readFileSync(PRODUCT_DOC_PATH, 'utf8');

    it('docs/product.md links the story and documents the bounded reload', () => {
        expect(product).toContain('stories/030-reload-stale-chunk/story.md');
        expect(product).toMatch(/hashed JS chunks while a tab is still open/i);
        expect(product).toMatch(/next failed dynamic import/i);
        expect(product).toMatch(/bounded one-time reload/i);
        expect(product).toMatch(/JavaScript MIME type/i);
    });
});
