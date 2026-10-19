# Installable PWA (start on `/home`) with the `pwa-install` dialog

## Context

UFF English is a Vite/React SPA on Cloudflare Pages. It has **no web app
manifest**, so the browser never offers to install it and there is no
home-screen app: the learner always opens a browser tab at
`https://ultrafastfluency.com/`, and `index.html` does not even declare a
favicon. The request is to make the app installable ("turn this into a PWA"),
have the **installed app open on the user dashboard `/home`** (not the public
marketing homepage `/`), and surface the install UI with
[`@khmyznikov/pwa-install`](https://github.com/khmyznikov/pwa-install).

Chrome's install criteria (`web.dev/articles/install-criteria`, last updated
2024-09-19) require: HTTPS, a manifest with `name`/`short_name`, a **192px and
a 512px icon**, `start_url`, a `display` of
standalone/fullscreen/minimal-ui/window-controls-overlay, and
`prefer_related_applications` absent or `false`. **A service worker with a fetch
handler is no longer required** — so the manifest alone makes the app
installable, and the generated service worker here is a scoped addition
(app-shell precache), not an install prerequisite.

### Tooling decision: `vite-plugin-pwa`, not PWABuilder

The request floated PWABuilder ("the free opensource version"). PWABuilder
(`github.com/pwa-builder/PWABuilder`, MIT) is a **remote packaging service**
(pwabuilder.com) and a VS Code extension: it scans a *deployed* site and hands
back a static `manifest.json` + `sw.js` + packaged store bundles. Those files
cannot track this app's build — Vite content-hashes every asset, so a
hand-downloaded `sw.js`/`manifest.json` precaching `assets/main-abc123.js`
would go stale on the next deploy and silently break the app, and it would have
to be regenerated and re-uploaded by hand every release.

`vite-plugin-pwa` (MIT, `vite-pwa/vite-plugin-pwa`) is the same capability
implemented as a **build-time** plugin for exactly this stack: it emits the
manifest from the Vite config, injects the `<link rel="manifest">` + the
registration script into the built `index.html`, and generates the Workbox
service worker with the *current* hashed chunk names. Icons come from its
companion `@vite-pwa/assets-generator` (MIT, sharp-based). PWABuilder's own docs
list `pwa-install` as its install component, so this keeps the requested
component and swaps only the stale-output generator for a build-integrated one.
(PWABuilder remains the right tool later if native store packages are wanted —
that is out of scope here.)

## Out of Scope

- **Offline lessons.** Only the app shell (JS/CSS/HTML/icons) is precached.
  Lesson media is on R2 (`assets/videos/<slug>.mp4`, a different origin), the
  Whisper/onnxruntime assets are excluded, and `src/config/*.json` is not
  precached, so the lesson player still needs the network. "Works offline" is
  not a claim of this story.
- Store packaging/submission (MSIX, Play Store, App Store) and iOS splash
  screens (`appleSplashScreens`).
- Any change to the route table, `/` landing content, or `PUBLIC_ROUTES`.
- Any change to Cloudflare `_headers`/`_redirects` semantics; the Pages SPA
  fallback already lets real files (`/sw.js`, `/manifest.webmanifest`, icons)
  win.
- Web push notifications, background sync, share target, shortcuts, or a
  custom install banner/card on the landing page.
- Native (`*.native.jsx`) variants — RN has no install dialog.
- PWA behaviour on the dev server: `devOptions.enabled` stays `false`, so
  `npm run dev` serves **no** manifest and registers no service worker (see
  Notes). PWA behaviour is exercised against the built app (`npm run preview`).

## Implementation approach

### Decisions

- **The manifest is a pure module, not inline config.**
  `scripts/lib/pwa-manifest.js` exports the constants plus
  `buildPwaManifest()`; `vite.config.js` passes it to `VitePWA`, and
  `scripts/lib/pwa-manifest.test.js` asserts the whole install contract against
  the real object — so "the installed app opens on `/home`" is a unit test, not
  a build artefact nobody checks. `start_url: '/home'`, `scope: '/'` (in-app
  navigation stays inside the PWA window), `id: '/'` (stable identity, so
  changing the launch page later is not a "different app"),
  `display: 'standalone'`, `theme_color`/`background_color: '#0b1a2a'` (the
  app shell's dark navy), `prefer_related_applications: false`. `vite.config.js`
  must not re-declare the launch URL (guarded).
- **Icons come from the app's existing square brand mark.**
  `@vite-pwa/assets-generator` writes its output next to its source image, so
  the source is `public/pwa-icon-source.png` — the lossless conversion of
  `src/assets/img/favicons/favicon-192x192.jpeg` (the mascot avatar on the brand
  gradient, already the app's intended favicon art; it is unreferenced today).
  A copy lives under `public/` because the manifest needs a stable public URL
  and Vite would content-hash the same file under `src/assets`. Deliberately
  **not** under `public/assets/**`: `public/_headers` serves that prefix
  `immutable` for a year and these filenames are not content-hashed. PNG, not
  the JPEG, because `scripts/generate-thumbnails.test.js` fails on any committed
  `jpg/jpeg/mp4` under `public/` (it keeps lesson media R2-only) and a lossless
  source does not amplify JPEG artifacts when the 192px art is upscaled to
  512px.
  `padding: 0` for every type (the source is already a full-bleed opaque
  square; a flat padding colour would seam against its own gradient, and
  Android's circular mask keeps the centred face, the usual treatment for an
  illustrated avatar icon). `npm run pwa:assets` regenerates the committed set
  (`pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`,
  `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`).
  The generated PNGs are committed (icons are tiny, stable and needed at a
  fixed path — unlike the R2-only posters).
- **The service worker precaches the shell, nothing else.** `generateSW` with
  `globPatterns` limited to `js/css/html/png/svg/ico/webmanifest/woff(2)`,
  `globIgnores` for `**/wasm/**` (109 MB of onnxruntime), `**/whisper/**`
  (the model/runtime assets under `public/whisper/**` — the tiny
  `assets/whisper-worker-*.js` bootstrap chunks are app-shell JS and *are*
  precached), `recorder.html` and `landing.html` (standalone pages that must be
  served as-is, never from the SPA shell), and `pwa-icon-source.png`.
  **The navigation deny list is a pure module with behavioural tests.**
  Workbox's `NavigationRoute` answers *every* same-origin `mode === 'navigate'`
  request from the precached shell unless it matches a deny-list pattern, so an
  incomplete list silently shadows real pages. Cloudflare serves
  `public/<name>.html` at its **extensionless** path (`public/recorder.html` →
  `/recorder`, `public/landing.html` → `/landing`) and 308-redirects the `.html`
  form, so the deny list must cover **both forms plus query strings** for each
  standalone page — denying only `.html` leaves `/landing` answered by the shell
  (React Router would then match `/:shareCode`). `scripts/lib/pwa-navigation-deny-list.js`
  exports `PWA_NAVIGATION_DENY_LIST` + `matchesPwaNavigationDenyList(pathnameAndSearch)`
  and its test asserts **behaviour** (`/landing`, `/landing.html`, `/landing?x=1`
  denied; `/home`, `/privacy`, `/courses`, `/abc12`, `/course/…` not), so a
  pattern that names an unreachable URL can no longer pass. `vite.config.js` only
  asserts that it wires the module in, not the config text.
- **The deny-list stems are derived from the repo, not from memory.**
  `pwa-navigation-deny-list.test.js` enumerates `public/*.html` and asserts the
  deny behaviour for every stem it finds — so adding `public/donate.html` (or
  renaming `landing.html`) fails the suite until the rule is extended, instead of
  silently serving the new page from the precached shell. Both failure modes were
  proven by temporarily breaking the rule (dropping `/landing` fails 9 tests;
  adding a throwaway `public/donate.html` fails 4).
- **The component contract is pinned against the real package, not just the mock.**
  `pwa-install-wiring.test.jsx` mocks `@khmyznikov/pwa-install` (so the home-screen
  subtree stays light), which means nothing there touches the real Lit bindings.
  `pwa-install-contract.test.jsx` imports the real bundle unmocked, upgrades a
  real (never-connected, so side-effect-free) `<pwa-install>` element, and asserts
  the attribute→property reflection (`manualApple`, `manualChrome`,
  `useLocalStorage`, `manifestUrl`) and the `showDialog`/`hideDialog`/`install`
  methods — so a prop rename in a future package bump fails here.
- **`registerType: 'prompt'` is inert as configured** (it is only consumed by the
  `virtual:pwa-register` client, which `injectRegister: 'script'` never emits) and
  is kept purely as pinned intent: a future update banner must start from a user
  prompt, never a forced reload.
  `maximumFileSizeToCacheInBytes` is 3 MB **with
  `showMaximumFileSizeToCacheInBytesWarning: true`**, so the oversized
  `idioms`/`idiom-worker` AI chunks (4.3 MB each) and the 6 MB
  `listeningbot` art are skipped with a warning instead of failing the build
  (the plugin's default is to throw).
- **No forced reload.** `registerType: 'prompt'` + `injectRegister: 'script'`
  injects a bare `navigator.serviceWorker.register('/sw.js', { scope: '/' })`;
  the app never imports `virtual:pwa-register`, so there is no
  `skipWaiting`/`clientsClaim` reload path. `autoUpdate` would reload a tab
  mid-lesson (losing an in-progress recording) — the app already has its own
  bounded stale-chunk reload (story 030).
- **The dialog is manual, the entry point is the home menu.** The
  `pwa-install` element is mounted **once** in `RootLayout`
  (`PWAInstallDialog.web.jsx`) with `manual-apple manual-chrome
  use-local-storage manifest-url="/manifest.webmanifest"`. Manual mode means it
  never opens by itself: this app already throws the guest language/login modal
  at first-time visitors, a second unsolicited overlay is a UX regression, and
  an auto-opening overlay would intercept clicks in the Playwright suite.
  `use-local-storage` makes a dismissal stick. The trigger is an "Install app"
  entry in the `/home` menu (`PWAInstallButton.web.jsx`, copy key
  `pwa_install_cta`, en/es/pt/fr/hi/bn).
- **The trigger and the element are bridged by a registry, not the DOM.** The
  menu subtree unmounts when the menu closes, so the `<pwa-install>` element
  cannot live inside it; and `showDialog()` must be called on an element that is
  still mounted. `install-prompt-webonly.js` holds the registered element
  (`registerInstallElement`/`getRegisteredInstallElement`) so the button never
  reaches into the DOM.
- **The button is hidden once the app is installed.**
  `readIsStandaloneApp()` (web-only module) reads
  `matchMedia('(display-mode: standalone)')` and iOS's
  `navigator.standalone`; `shouldOfferInstall({ isStandalone })` (pure module)
  decides. Every read is fail-closed to "not installed" so a capable browser
  that lacks `matchMedia` (jsdom, older engines) still sees the entry point, and
  a broken dialog can never break the menu (`openInstallDialog` is fail-open).
- **The heavy web component never reaches the home screen's tests.**
  `PWAInstallButton.web.jsx` does not import `@khmyznikov/pwa-install` (only
  `PWAInstallDialog.web.jsx` does, and it is mounted in `RootLayout`), so
  `HomeScreen.test.jsx` does not pull the ~1.8 MB Lit bundle into jsdom
  (guarded).
- **One new UI string**, `pwa_install_cta`, carrying the full UI language set
  (en/es/pt/fr/hi/bn); native-speaker review of the non-English drafts is a
  follow-up, exactly as for stories 056/059.

### Layout

```
scripts/lib/pwa-manifest.js        manifest constants + buildPwaManifest()
scripts/lib/pwa-navigation-deny-list.js  pure rule: the navigations the shell must never answer
scripts/lib/pwa-manifest.test.js   install contract + on-disk icons + build wiring
scripts/lib/pwa-build-output.test.js  runs the production build, asserts the emitted artefacts + precache
scripts/lib/pwa-navigation-deny-list.test.js  behaviour of the deny rule for real URLs (stems derived from public/*.html)
pwa-assets.config.js               icon generation (npm run pwa:assets)
vite.config.js                     VitePWA(...) — manifest, Workbox, register
index.html                         favicon/apple-touch-icon/theme-color head tags
public/pwa-icon-source.png        icon source (copy of the brand favicon)
public/pwa-*.png public/maskable-*.png public/apple-touch-*.png public/favicon.ico
src/modules/pwa/install-prompt-logic.js      pure rules
src/modules/pwa/install-prompt-webonly.js    display-mode read + element registry
src/components/pwa/PWAInstallDialog.web.jsx  mounts <pwa-install> (RootLayout)
src/components/pwa/PWAInstallButton.web.jsx  the menu entry point
src/components/pwa/pwa-install-contract.test.jsx  real-package contract (unmocked)
src/routes/RootLayout.jsx                    + <PWAInstallDialog />
src/components/homescreen/HomeScreen.jsx     + <PWAInstallButton /> in the menu
src/data/strings.js                          + pwa_install_cta
```

## Tasks

### Task 1 - Web app manifest, install criteria and icons

- `buildPwaManifest()` + `START_URL` / `APP_SCOPE` / `APP_ID`
  - → `start_url === '/home'`, `scope === '/'`, `id === '/'`
- `buildPwaManifest()`
  - → `display === 'standalone'` (one of the 4 installable values)
  - → non-empty `name`/`short_name`/`description`; `short_name === 'UFF'`
  - → `prefer_related_applications === false`
  - → `theme_color`/`background_color` are 6-digit hex and equal the exported constants
- `PWA_ICONS` + the generated files
  - → has an `any` 192x192 and an `any` 512x512 icon and a `maskable` 512x512 icon
  - → every icon `src` is absolute (`/…`) and `type === 'image/png'`
  - → every icon file exists in `public/` and its PNG IHDR width/height equal the declared `sizes`
- head-link icons
  - → `public/favicon.ico` and `public/apple-touch-icon-180x180.png` exist and are non-empty
- the icon source
  - → `public/pwa-icon-source.png` exists as a 192x192 PNG and `public/pwa-icon-source.jpeg` does not (committed `jpg/jpeg/mp4` under `public/` is forbidden by `scripts/generate-thumbnails.test.js`, which keeps lesson media R2-only)
- `index.html`
  - → contains `<link rel="icon" href="/favicon.ico" sizes="any">` and `<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">`
  - → contains `<meta name="theme-color" content="<THEME_COLOR>">` (tied to the manifest constant), `mobile-web-app-capable` and `apple-mobile-web-app-capable` = yes
- `vite.config.js` / `package.json`
  - → imports `VitePWA` and `buildPwaManifest`, passes `manifest: buildPwaManifest()`, `manifestFilename: 'manifest.webmanifest'`, and never inlines the launch URL (`start_url` absent)
  - → `package.json` has the `pwa:assets` script, `vite-plugin-pwa` + `@vite-pwa/assets-generator` as devDependencies and `@khmyznikov/pwa-install` as a dependency
  - → `pwa-assets.config.js` generates from `public/pwa-icon-source.png`

### Task 2 - App-shell service worker

- `vite.config.js` `VitePWA` options
  - → `strategies: 'generateSW'`, `registerType: 'prompt'`, `injectRegister: 'script'`, and no `autoUpdate` (no forced mid-session reload)
  - → `navigateFallback: 'index.html'` and `navigateFallbackDenylist: PWA_NAVIGATION_DENY_LIST` (the pure rule from `scripts/lib/pwa-navigation-deny-list.js`)
  - → for every standalone page (`/recorder`, `/landing`): `/x`, `/x.html`, `/x?y=1` and `/x.html?y=1` are denied by `matchesPwaNavigationDenyList`
  - → client routes (`/`, `/home`, `/privacy`, `/terms`, `/confirm-email?token=…`, `/courses`, `/login`, `/profile`, `/course/<c>/lesson/<l>`, `/<shareCode>`) are NOT denied, so the offline shell still serves them
  - → `/api/`, `/assets/` and `/whisper/` prefixes are denied
  - → an empty/non-string input is denied as `false`, and every pattern is `^`-anchored (an unanchored one could match mid-path)
  - → `globIgnores` includes `**/wasm/**`, `**/whisper/**`, `**/*.test.js`, `recorder.html`, `landing.html`
  - → `cleanupOutdatedCaches: true` and a `maximumFileSizeToCacheInBytes` cap
  - → `showMaximumFileSizeToCacheInBytesWarning: true` (oversized chunks are skipped, not a build error)
  - → `devOptions: { enabled: false }`
- a production build (`scripts/lib/pwa-build-output.test.js` runs `npm run build` and asserts on `dist/`)
  - → emits `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest`, `dist/registerSW.js`
  - → `dist/index.html` carries `<link rel="manifest" href="/manifest.webmanifest">` and the `registerSW.js` script
  - → the emitted `manifest.webmanifest` parses with `start_url: '/home'`, standalone display, scope `/` and 192/512 icons
- the generated precache manifest (same test, reading `dist/sw.js`)
  - → contains `index.html`, `manifest.webmanifest`, the icons and the hashed app chunks
  - → contains no `wasm/`, `whisper/`, `recorder.html`, `landing.html`, `idioms-*`, `listeningbot-*`, `pwa-icon-source` or `.test.js` entry
  - → the emitted navigation route wires the deny list verbatim (both extensionless standalone forms present)

### Task 3 - `pwa-install` dialog and the install entry point

- `PWAInstallDialog` rendered
  - → mounts exactly one `<pwa-install>` carrying `manual-chrome`, `manual-apple`, `use-local-storage` and `manifest-url="/manifest.webmanifest"`
  - → registers the mounted element for the trigger, and clears the registration on unmount
- `PWAInstallButton` rendered (not installed)
  - → renders `[data-testid="install-app"]` containing the label
- the entry point clicked with a registered element
  - → calls `onBeforeOpen()` then `showDialog(false)` on the registered element
- the entry point clicked with no element mounted (or a `showDialog` that throws)
  - → does not throw (`openInstallDialog` fail-open)
- `shouldOfferInstall`
  - → `{ isStandalone: true }` false; `{}` / `{ isStandalone: false }` / no argument true
- `readIsStandaloneApp`
  - → true from `matchMedia('(display-mode: standalone)')`, true from
    `navigator.standalone`, false when `matchMedia` is absent (jsdom) and false
    when the media query throws
- the install element registry
  - → `getRegisteredInstallElement()` is null before registration, returns the
    registered element, and returns null again after a falsy registration
- `install-prompt-logic.js`
  - → contains no React import, no `window.`, no `document.` (pure module)
- source wiring
  - → `RootLayout.jsx` imports and renders `<PWAInstallDialog />`
  - → `HomeScreen.jsx` imports and renders `<PWAInstallButton>` with `Strings.get('pwa_install_cta', lang)`
  - → `PWAInstallButton.web.jsx` does **not** contain `@khmyznikov/pwa-install`; `PWAInstallDialog.web.jsx` does
- the real package contract (unmocked, `pwa-install-contract.test.jsx`)
  - → importing `@khmyznikov/pwa-install` registers the `pwa-install` custom element
  - → a real element reflects `manual-apple`/`manual-chrome`/`use-local-storage`/`manifest-url` into `manualApple`/`manualChrome`/`useLocalStorage`/`manifestUrl`
  - → a real element exposes `showDialog`, `hideDialog` and `install` as functions
- `src/data/strings.js`
  - → `pwa_install_cta` carries en/es/pt/fr/hi/bn, with real Devanagari and Bengali copy (so `strings.test.js` hi/bn coverage passes)

## Bootstrap

```bash
npm install -D vite-plugin-pwa@2.0.0 @vite-pwa/assets-generator@1.0.4
npm install @khmyznikov/pwa-install@0.7.0
npm run pwa:assets   # regenerate public/pwa-*.png, maskable-icon-512x512.png, apple-touch-icon-180x180.png, favicon.ico
npm run build        # emits dist/manifest.webmanifest, dist/sw.js, dist/registerSW.js
```

## Technical Context

- **`vite-plugin-pwa` 2.0.0** — MIT; peers `vite ^3.1 || … || ^8.0`, so it is
  compatible with this repo's Vite 8.0.10 (its `generateSW` strategy uses
  `workbox-build`/`workbox-window` 7.4.1).
- **`@vite-pwa/assets-generator` 1.0.4** — MIT; generates the icon set with
  `sharp` (+ `sharp-ico` for the `.ico`). Its `minimal-2023` preset is
  `transparent: [64, 192, 512] + favicon ico`, `maskable: [512]`,
  `apple: [180]`.
- **`@khmyznikov/pwa-install` 0.7.0** — MIT, a Lit web component
  (`<pwa-install>`). React 19 renders custom elements natively (no polyfill);
  `manual-chrome`/`manual-apple` suppress its automatic dialog, and boolean
  attributes are read as "present = true" by Lit's `Boolean` converter, so
  React passing the string `"true"` works (verified in a real browser).
- Versions above are the ones actually installed by `Bootstrap`; npm resolved
  `vite-plugin-pwa@2.0.0`, `@vite-pwa/assets-generator@1.0.4` and
  `@khmyznikov/pwa-install@0.7.0`.

## Notes

- **Verifying PWA behaviour.** `npm run dev` intentionally serves no manifest
  and no service worker (`devOptions.enabled: false` — enabling it would run a
  service worker against the dev server, caching modules across HMR and
  interfering with the existing Playwright suite). The build artefacts and the
  precache list are pinned by `scripts/lib/pwa-build-output.test.js`, which runs
  `npm run build` and asserts on `dist/` — so only the live-browser behaviours
  below stay manual. Done during this story in headless Chromium against
  `vite preview`: the element upgrades, `showDialog` exists, the dialog starts
  hidden, `<pwa-install>` carries all three manual attributes and
  `manifest-url`, the `/home` menu entry renders, clicking it opens the dialog
  (`isDialogHidden === false`), the service worker registers at scope `/`, the
  manifest link resolves, and the console is clean.
- **The deny list is what stops the shell shadowing real pages.** Verified in
  headless Chromium against `vite preview` with the worker controlling: `/home`
  is served from the precache (`transferSize: 0`), while `/landing` and
  `/recorder` are answered by the **network** (`transferSize: 13231` / `10684`)
  and render no React root — the shell did not shadow them. `vite preview` has
  no Cloudflare extensionless routing, so those URLs 404 there; what is being
  asserted is that the service worker did not answer them from the cached shell.
- **COEP/COOP survive the service worker.** The app needs `credentialless`
  isolation for `SharedArrayBuffer` (whisper/onnxruntime threads). Checked in
  the same run with the worker controlling the tab: `window.crossOriginIsolated`
  is `true` and `SharedArrayBuffer` is defined, because Workbox precaches the
  response *with* its headers. Without this, a regression would surface as a
  WASM thread failure, not a load error.
- **`public/pwa-icon-source.png` is a lossless conversion of
  `src/assets/img/favicons/favicon-192x192.jpeg`** (192x192, the largest
  available copy of that art). If the brand mark changes, replace the source and
  run `npm run pwa:assets`; the 512px icons are an upscale of the 192px
  original, which is the quality ceiling of the existing asset. Keep it a PNG:
  the `no committed poster images` guard in `scripts/generate-thumbnails.test.js`
  fails on any committed `jpg/jpeg/mp4` under `public/`.
- **Chrome no longer requires a service worker for installability**, so the SW
  can be dropped later without losing the install prompt; the manifest is the
  contract.
- **`@khmyznikov/pwa-install` ships its own translations** for the dialog
  (including es/pt/fr/hi/bn), so only the app-owned menu label needed a
  `strings.js` key.
- **The install prompt needs engagement** (a click and ~30s on the page) before
  `beforeinstallprompt` fires, so a fresh headless profile reports
  `isInstallAvailable: false`; the manual trigger still opens the dialog and the
  component falls back to platform instructions. This is why the dialog is
  manual: an auto-opening overlay would be timing-dependent and
  test-nondeterministic.
- Non-obvious repo guardrails respected: nothing new under `src/**` mentions the
  operator recorder page (the reference sits in `vite.config.js`'s navigation
  denylist, which `recorder-page.test.js` does not scan); the new logic modules
  hold no React/DOM; `HomeScreen.jsx` stays render-only (the button owns its own
  visibility rule).
- **Interaction with the existing stale-chunk reload.** Once the service worker
  controls a tab, dynamic imports of precached chunks succeed from the cache, so
  `vite:preloadError` fires less often and `installStaleChunkReload` (story 030)
  becomes largely inert for precached chunks. That is coherent with
  `registerType: 'prompt'` — an old tab keeps running the old shell until it is
  closed and reopened — and the mechanism is untouched, but it is a behavioural
  change worth knowing when debugging a "stale deploy" report.
- **The dialog package is loaded eagerly** by `PWAInstallDialog` in
  `RootLayout` (~142 KB raw / ~45 KB Brotli for `pwa-install.es.js`, plus its
  Lit/inapp-spy deps) for every visitor, because the element must exist before
  the menu can ask it to open. It is not on the lesson critical path (the dialog
  is inert in manual mode) but it is a real addition to first-load bytes.
