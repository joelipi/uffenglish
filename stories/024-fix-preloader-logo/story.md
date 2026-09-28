# Fix broken logo on the React loading screen

## Context

On app startup the React loading overlay (`src/components/Preloader.jsx`) renders the UFF logo as `<img src="/logo.png" alt="UFF" />` (lines 5 and 82). No `logo.png` file exists in `public/` (or anywhere else in the repo), so the request 404s and the browser shows a broken-image icon with the "UFF" alt text on the blue loading screen.

This is a regression introduced by commit `b61b340` ("Updated preloader with Loading message and logo"), which replaced `import uffLogo from '../assets/img/u-f-f.png';` with the hardcoded `const uffLogo = '/logo.png';` at the same time it switched from a CSS background to an `<img>` element. The logo asset `src/assets/img/u-f-f.png` still exists in the repo (byte-identical to `public/assets/img/u-f-f.png`), and the inline HTML preloader in `index.html` correctly loads `/assets/img/u-f-f.png`.

## Out of Scope

- The inline HTML preloader in `index.html` (`#appLoadingImageDiv` / `.appLoadingImage`) — it already resolves to an existing file (`/assets/img/u-f-f.png`).
- The duplicated asset (`src/assets/img/u-f-f.png` and `public/assets/img/u-f-f.png` are identical) — deduplication is not part of this fix.
- Rendering/design changes to the Preloader (position, size, animations, "Loading..." label, progress bar).
- Adding a new `public/logo.png` — the fix reuses the existing logo asset.
- Images in `public/landing.html`.

## Implementation approach

In `src/components/Preloader.jsx`, replace the hardcoded public URL with a module import of the existing asset:

```js
import uffLogo from '../assets/img/u-f-f.png';
```

and delete `const uffLogo = '/logo.png';`.

Rationale, all grounded in the codebase:

- This restores the exact pre-`b61b340` implementation, which was working.
- It matches the repo's dominant asset convention: 31 imports from `src/assets/img/` across 14 files under `src/` (e.g. `src/modules/answer/answer-pipeline.js`, `src/modules/user/bot-identity.js`, `src/components/chat/PraiseBubble.jsx`).
- Vite fingerprints and emits the imported asset into the build output, so the URL cannot point at a missing file; Vite also fails the build if the import path is wrong.
- Keep the existing render unchanged: `<img src={uffLogo} alt="UFF" style={styles.logo} />`.
- Do not touch `public/assets/img/u-f-f.png` or `index.html`.

The Preloader is rendered by `src/routes/RootLayout.jsx`. Vitest can import `.png` assets; in the jsdom test environment `import logo from '../assets/img/u-f-f.png'` resolves to the string `/src/assets/img/u-f-f.png` (verified with a probe run against this repo).

## Tasks

### Task 1 - Point the Preloader logo at an existing asset

- `Preloader` rendered with `preloaderVisible = true` + inspect the rendered `img`
  - → an `img` element exists
  - → `img.getAttribute('src')` is a non-empty string
  - → the `src` value is not the literal `"/logo.png"`
  - → the `src` resolves to a file that exists under the repo root (checking both the repo root and `public/`; e.g. `/src/assets/img/u-f-f.png` → `src/assets/img/u-f-f.png`, which exists)
- `src/components/Preloader.jsx` read as source text
  - → no longer contains the string `'/logo.png'`
  - → references the existing logo asset (`u-f-f.png`)
- `Preloader` rendered with `preloaderVisible = false`
  - → renders nothing (no `img` element), preserving existing hide behavior

## Technical Context

- No new dependencies; the fix uses the existing `src/assets/img/u-f-f.png`.
- Unit tests run under Vitest with the `jsdom` environment (`vitest.config.js`; `npm test`). The repo has no `@testing-library`; component tests use `createRoot` + `act` from `react-dom/client` and `react` (see `src/components/intro-caller-name.test.js`).
- Source-guard / wiring tests read files with `node:fs` `readFileSync` and `import.meta.url` (see `src/components/video-overlay-italic.test.js`, `src/components/intro-caller-name.test.js`).
- Store actions used by the test setup exist on `appStore`: `setPreloaderVisible`, `setPreloaderProgress`, `setReactReady`, `setIntroPosterReady` (`src/modules/store/store.js`). The default state has `preloaderVisible: true` and `preloaderProgress: 0`.
- Vitest resolves `import logo from '../assets/img/u-f-f.png'` to `/src/assets/img/u-f-f.png` in this repo (confirmed via a throwaway probe test); a production `vite build` emits the hashed equivalent.

## Notes

- `src/assets/img/u-f-f.png` and `public/assets/img/u-f-f.png` are byte-identical (md5 `9317aa3ac0d86985a100aac942a21163`). The inline `index.html` preloader keeps using the `public/` copy; only the React Preloader changes.
- The Preloader's `useEffect` calls `startProgressPulse()`, which sets a module-level interval in `src/hooks/usePreloader.js`. Tests must unmount the component (and reset `preloaderVisible`) to avoid leaking the interval between tests.
- Non-automatable: visual confirmation on a real device that the UFF logo (not a broken-image icon) is shown. The src-existence assertion above is the automated equivalent of that check.
