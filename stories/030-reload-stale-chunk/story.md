# Reload once when a stale deploy breaks a dynamic import

## Context

`deploy.yml` production-deploys `main` on every push and serves it via Cloudflare Pages. Vite emits content-hashed chunks (`assets/video-processor-<hash>.js`), and the entry chunk imports them by hash — the built `video-processor` chunk even imports `main-<hash>.js`, so the hashes are interlocked and change on essentially every bundle-changing deploy.

When a new deployment goes live, the previous deployment's hashed chunks disappear from the production domain. A browser tab that is still running the old entry chunk keeps referencing the old names. The next dynamic import then fetches a chunk that no longer exists; Cloudflare Pages' SPA fallback (`public/_redirects`: `/*  /index.html  200`) answers with `index.html` and `Content-Type: text/html`, so the browser rejects it with:

```
TypeError: 'text/html' is not a valid JavaScript MIME type.
```

This is exactly what surfaced in the success flow: `SuccessButtons.runProcessing` (`src/components/widgets/SuccessButtons.jsx:79`) does `await import('../../modules/video/video-processor.js')`, and its `catch` (`:143-147`) logs `[Success] Video generation failed` and alerts. `main` received 158 bundle-changing commits in the last 14 days, so any tab open across a deploy is exposed.

Vite already dispatches a cancelable `vite:preloadError` event on `window` from its preload helper when a dynamic import fails (confirmed in the shipped bundle: `function i(e){let t=new Event("vite:preloadError",{cancelable:!0}); ... window.dispatchEvent(t),!t.defaultPrevented&&throw e}`). Nothing in this repo listens for it. This story adds a one-time reload handler so an open tab self-heals instead of failing.

## Out of Scope

- No change to `public/_redirects` or `public/_headers`. Cloudflare Pages `_redirects` cannot return a 404 for `/assets/*`, and `Cache-Control: no-cache` on `/*` already means a fresh page load always gets current HTML.
- No change to the deploy workflow, chunking, or manual chunk configuration.
- No retry/backoff or user-facing "a new version is available" banner — a single silent reload is the whole behavior.
- No change to the subtitle logic from story 028.
- No new dependency.

## Implementation approach

### New pure module — `src/modules/utils/stale-chunk-reload.js`

All DOM access is injected so the module is unit-testable without a browser (`win` defaults to the real `window`). Constants and logic:

```js
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
```

Rules:
- The listener is registered synchronously on `vite:preloadError`; the event payload is ignored.
- A reload happens only when a usable `sessionStorage` is present; every storage read/write is guarded, and a failure aborts the reload (fail safe, never loops).
- At most `MAX_STALE_CHUNK_RELOADS` (2) reloads per browser session/tab, counted in sessionStorage; a third failure is left to the caller's normal error path. This bounds any reload loop without needing a "clear on boot" step.
- `win.__uffStaleChunkReloading` is set immediately before `reload()` so callers can suppress their own error UI for the in-flight navigation.

### Wiring — `src/main.jsx`

Import `installStaleChunkReload` and call it at module scope, before `createRoot(...).render(...)`, so the listener exists before any dynamic import in the app. Because the entry chunk that registers the listener is the same chunk a stale tab is already running, the guard protects every deployment that includes it (builds before this change cannot be protected — one-time transition).

### Wiring — `src/components/widgets/SuccessButtons.jsx`

In `runProcessing`'s `catch`, return early (before `trackEvent`/`console.error`/`alert`/`setVideoState('idle')`) when `isStaleChunkReloadPending()` is true: the page is already reloading to recover the stale deploy, so the user must not see the "Failed to generate video" alert. Non-stale errors keep today's behavior exactly.

## Tasks

### Task 1 - Add `stale-chunk-reload.js` with reload-once semantics

Tests live in `src/modules/utils/stale-chunk-reload.test.js` and drive the module with a fake `win` (`{ addEventListener: vi.fn(), sessionStorage, location: { reload: vi.fn() } }`) — no jsdom required.

- `installStaleChunkReload(fakeWin)` is called + inspect `fakeWin.addEventListener`
  - → it was called with `'vite:preloadError'` and a function.
- registered handler invoked with an empty sessionStorage
  - → `sessionStorage` count is set to `'1'`.
  - → `fakeWin.location.reload` was called exactly once.
  - → `isStaleChunkReloadPending(fakeWin)` is `true`.
- registered handler invoked when count is `'1'`
  - → count becomes `'2'` and `reload` is called (the second allowed recovery).
- registered handler invoked when count is `'2'` (the cap)
  - → `reload` is not called, count stays `'2'`, and `__uffStaleChunkReloading` is not set.
- handler invoked when count is a non-numeric/garbage value
  - → treated as `0` and reloads (count becomes `'1'`).
- handler invoked when `sessionStorage` is absent or its getter throws
  - → `reload` is not called (fail safe, no loop).
- handler invoked when `setItem` throws
  - → `reload` is not called and no flag is set.
- `isStaleChunkReloadPending(fakeWin)` on a fresh fake win
  - → `false`.
- `installStaleChunkReload()` and `isStaleChunkReloadPending()` with the default argument
  - → do not throw when `window` exists (smoke test; the module reads the global lazily, not at import time).

### Task 2 - Wire the guard into the entry point and the success flow

Wiring is asserted by reading the sources (the repo already uses source-reading tests, e.g. `src/modules/video/video-processor-web-guard.test.js`); a browser E2E is not possible for a mid-deploy chunk swap.

- `src/main.jsx` source read
  - → it imports `installStaleChunkReload` from `./modules/utils/stale-chunk-reload.js`.
  - → the `installStaleChunkReload()` call appears before `createRoot`.
- `src/components/widgets/SuccessButtons.jsx` source read
  - → it imports `isStaleChunkReloadPending`.
  - → `isStaleChunkReloadPending()` is checked before the `alert(...)` in the `[Success] Video generation failed` catch block.
- full suite `npm test -- --run` (workdir = repo root)
  - → passes.

### Task 3 - Document the recovery behavior

Add a Features bullet to `docs/product.md` and assert it in the same test file (precedent: `scripts/generate-captions.test.js:72-75`).

- test reading `docs/product.md`
  - → it contains the link `stories/030-reload-stale-chunk/story.md`.
  - → a Features bullet states that if a new deployment replaces the hashed JS chunks while a tab is open, the next failed dynamic import triggers a bounded one-time reload instead of a MIME error.

## Technical Context

- No new dependencies. Tests use the existing `vitest ^4.1.6` (`npm test -- --run`).
- Vite's preload helper dispatches `vite:preloadError` (cancelable, on `window`) for both the preload-dependency loop and the dynamic import itself (`e().catch(i)`), so one window listener covers all dynamic imports. Confirmed in the deployed bundle `assets/main-CQDGqfzx.js`.
- The stale chunk currently returns `200 text/html` (verified against production: an old `video-processor-*.js` and a bogus name both return `index.html`), so the guard is the fix, not a redirects change.
- `public/_headers` sets `Cache-Control: no-cache` on `/*`, so a reload revalidates `index.html` and picks up the new chunk names; hashed `/assets/*` are `immutable` but only ever referenced by the chunk names in the HTML/meta chunks that are re-fetched.
- `docs/product.md` was updated by story 028 in the same Features list; keep the existing relative-link format and insert this bullet near the other recap/deploy entries.
- `agents.md` §32/§36: confirm `git branch --show-current` before committing; the shared worktree can switch branches mid-task.

## Notes

- The guard only exists in builds that include it. Tabs already open on an older build keep the old behavior until they reload once — a one-time transition after this ships.
- The cap of 2 reloads per tab is deliberately small: it recovers real deploy-skew while guaranteeing a broken deployment cannot cause an endless reload loop. No "clear on boot" is used, so the count persists for the tab's lifetime.
- Fail-safe choice: when `sessionStorage` is unavailable (e.g. some private modes) the handler does nothing rather than risk an unbounded reload loop; those users still see the existing error and must reload manually.
- The handler ignores the event payload and does not call `preventDefault()`, so behavior for callers other than `SuccessButtons` (they simply reject) is unchanged apart from the imminent reload.
- Verification limit: the real trigger needs a deploy to land between page load and the dynamic import, which cannot be exercised in CI. The contract under test is the handler's reload/no-reload decision plus the wiring assertions.
