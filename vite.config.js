import { resolve } from 'path'
import { existsSync, mkdirSync, cpSync, copyFileSync } from 'fs'
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import purgecss from 'vite-plugin-purgecss'
import { VitePWA } from 'vite-plugin-pwa'
import { homepageBootstrapPlugin } from './scripts/lib/bootstrap-homepage-plugin.js'
import { buildPwaManifest } from './scripts/lib/pwa-manifest.js'
import { PWA_NAVIGATION_DENY_LIST } from './scripts/lib/pwa-navigation-deny-list.js'

// Installable-app (PWA) build config. The manifest object lives in
// scripts/lib/pwa-manifest.js so its contract (the installed app launches on
// the `/home` dashboard, standalone display, 192/512 icons) is unit-testable
// without a build.
//
// The generated service worker precaches the app SHELL (JS/CSS/HTML + icons)
// with an SPA navigation fallback. Lesson media (R2 `assets/videos`, a different
// origin), the `public/wasm/**` and `public/whisper/**` model/assets, the
// oversized AI chunks and the pipeline Functions stay network-only, so offline
// is a shell, not a lesson player.
// `injectRegister: 'script'` is what produces the bare
// `navigator.serviceWorker.register` (no `virtual:pwa-register` client, hence no
// reload path that could interrupt an in-progress recording). `registerType` is
// only consumed by that client, which we do not emit — so it is inert today and
// is kept (pinned by pwa-manifest.test.js) purely as intent: when an "update
// available" banner is wanted later, the client path must start from a user
// prompt, never from a forced reload. The app already has its own bounded
// stale-chunk reload (see src/modules/utils/stale-chunk-reload.js), which is now
// mostly masked because precached chunks resolve from the service worker cache —
// the trade-off is documented in stories/062-pwa-install.
const WORKBOX_IGNORES = [
    // Redundant with globPatterns (which has no `wasm` extension), but kept so
    // a future globPatterns edit cannot silently start precaching the 109 MB
    // of onnxruntime binaries under public/wasm.
    '**/wasm/**',
    // Test files ride along when copy-config mirrors src/config/** into dist/
    // — they are never requested by the app, so they must not be precached.
    '**/*.test.js',
    // Only the model/runtime assets under public/whisper/**; the tiny
    // whisper-worker bootstrap chunks emitted into assets/ are app-shell JS
    // and are intentionally precached.
    '**/whisper/**',
    // Operator-only studio and the legacy static landing: served as-is, never
    // from the precached SPA shell.
    'recorder.html',
    'landing.html',
    // Optional prop art for the recording looks (stories/091): a learner who
    // never picks a prop must not pay for the download, so keep it out of the
    // precache and fetch it on demand.
    '**/overlays/**',
    // The full Twemoji manifest is only fetched when the Emoji drawer opens;
    // keeping it out of the precache avoids charging every learner for it.
    '**/twemoji-emojis-*.js',
    // Icon-generation source (see pwa-assets.config.js).
    'pwa-icon-source.png',
]

const commitHash = execSync('git rev-parse --short HEAD').toString().trim()

export default defineConfig({
    plugins: [
        homepageBootstrapPlugin(),
        {
            name: 'inject-version',
            transformIndexHtml(html) {
                return html.replace(
                    /<title>(.*?)<\/title>/,
                    `<title>${commitHash} $1</title>`
                )
            }
        },
        {
            name: 'copy-config',
            closeBundle() {
                const distConfig = resolve(__dirname, 'dist/src/config')
                if (!existsSync(distConfig)) mkdirSync(distConfig, { recursive: true })
                cpSync(resolve(__dirname, 'src/config'), distConfig, { recursive: true })
                console.log('[copy-config] Copied config JSONs to dist/src/config/')

                // Ensure Cloudflare Pages _headers and _redirects are in build output.
                // Vite copies public/ by default, but explicit copy is belt-and-suspenders
                // — these files are critical for COOP/COEP headers in production.
                for (const f of ['_headers', '_redirects']) {
                    const src = resolve(__dirname, 'public', f)
                    const dst = resolve(__dirname, 'dist', f)
                    if (existsSync(src)) {
                        copyFileSync(src, dst)
                        console.log(`[copy-config] Copied ${f} to dist/`)
                    } else {
                        console.warn(`[copy-config] WARNING: public/${f} not found`)
                    }
                }
            }
        },
        purgecss({
            safelist: [
                /^ivp-token-/,
                /^step-/,
                'toggled-off',
                'btn-bounce',
                'expanded',
            ]
        }),
        VitePWA({
            strategies: 'generateSW',
            registerType: 'prompt',
            injectRegister: 'script',
            manifest: buildPwaManifest(),
            manifestFilename: 'manifest.webmanifest',
            workbox: {
                globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff,woff2}'],
                globIgnores: WORKBOX_IGNORES,
                // A new deploy must become reachable. Without this, a new worker
                // installs and WAITS while any client is open, so a reload keeps
                // being answered from the previous precache — on iOS an installed
                // PWA or a long-lived tab can sit on an old build indefinitely
                // (stories/092: two rounds of fixes were invisible on the test
                // device because of exactly that). `skipWaiting` activates the
                // new worker as soon as it installs, so the NEXT navigation runs
                // the new build; `clientsClaim` is deliberately NOT set, so a
                // page that is mid-recording is never claimed (and never has its
                // old chunks swapped underneath it) while the learner is working.
                skipWaiting: true,
                // SPA client routes are served from the precached shell; the
                // deny list is the load-bearing part. Workbox's NavigationRoute
                // would otherwise answer EVERY same-origin navigation (any
                // `mode === 'navigate'` request) from the cached shell, which
                // would shadow the operator studio and the legacy landing page.
                // The rule (and its unit tests) live in
                // scripts/lib/pwa-navigation-deny-list.js.
                navigateFallback: 'index.html',
                navigateFallbackDenylist: PWA_NAVIGATION_DENY_LIST,
                cleanupOutdatedCaches: true,
                // Add the Web Push listeners (push / notificationclick /
                // pushsubscriptionchange) from public/push-sw.js on top of the
                // generated worker. importScripts keeps every reviewed piece of
                // the generated SW (precache patterns, navigation fallback and
                // its deny list) as config instead of re-implementing it (as
                // injectManifest would).
                importScripts: ['push-sw.js'],
                // Chunk-size cap for precaching, with skipping allowed instead of
                // the plugin's default build failure: anything above it (the
                // onnxruntime/transformers chunks) stays network-only.
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
            },
            // Skipping oversized chunks instead of the plugin default (which
            // fails the build) — see `maximumFileSizeToCacheInBytes` above.
            showMaximumFileSizeToCacheInBytesWarning: true,
            devOptions: { enabled: false },
        }),
    ],
    optimizeDeps: {
        include: ['@huggingface/transformers'],
    },
    resolve: {
        extensions: ['.web.jsx', '.web.js', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
        },
    },
    worker: {
        format: 'es',
    },
    server: {
        allowedHosts: ['t.ultrafastfluency.com'],
        proxy: {
            '/assets/videos/': {
                target: 'https://r2.ultrafastfluency.com',
                changeOrigin: true,
            },
            '/whisper/': {
                target: 'https://r2.ultrafastfluency.com',
                changeOrigin: true,
            },
            '/api': {
                target: 'http://localhost:8788',
                changeOrigin: true,
            },
        },
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Resource-Policy': 'same-origin',
        },
    },
    preview: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Resource-Policy': 'same-origin',
        },
    },
})