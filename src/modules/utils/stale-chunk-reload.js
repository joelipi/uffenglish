export const STALE_CHUNK_RELOAD_COUNT_KEY = 'uff:stale-chunk-reload-count';
export const MAX_STALE_CHUNK_RELOADS = 2;

export function installStaleChunkReload(win = window) {
    const handler = () => {
        let store = null;
        try { store = win.sessionStorage; } catch { store = null; }
        if (!store) return; // no sessionStorage → cannot bound the reloads, so don't reload

        let count = 0;
        try { count = Number(store.getItem(STALE_CHUNK_RELOAD_COUNT_KEY)) || 0; } catch { return; }
        if (count >= MAX_STALE_CHUNK_RELOADS) return;

        try { store.setItem(STALE_CHUNK_RELOAD_COUNT_KEY, String(count + 1)); } catch { return; }

        win.__uffStaleChunkReloading = true;
        win.location.reload();
    };
    win.addEventListener('vite:preloadError', handler);
    return handler;
}

export function isStaleChunkReloadPending(win = window) {
    return win.__uffStaleChunkReloading === true;
}
