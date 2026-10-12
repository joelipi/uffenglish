import { resolve } from 'path'
import { existsSync, mkdirSync, cpSync, copyFileSync } from 'fs'
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import purgecss from 'vite-plugin-purgecss'
import { VitePWA } from 'vite-plugin-pwa'
import { homepageBootstrapPlugin } from './scripts/lib/bootstrap-homepage-plugin.js'
import { buildPwaManifest } from './scripts/lib/pwa-manifest.js'

// Installable-app (PWA) build config. The manifest object lives in
// scripts/lib/pwa-manifest.js so its contract (the installed app launches on
// the `/home` dashboard, standalone display, 192/512 icons) is unit-testable
// without a build.
//
// The generated service worker precaches the app SHELL (JS/CSS/HTML + icons)
// with an SPA navigation fallback. Lesson media (R2 `assets/videos`), the
// Whisper/onnxruntime assets and the pipeline Functions stay network-only, so
// offline is a shell, not a lesson player. `registerType: 'prompt'` plus
// `injectRegister: 'script'` means a plain `navigator.serviceWorker.register`
// is injected — no `virtual:pwa-register`, so a new build never force-reloads a
// tab mid-lesson (the app already has its own bounded stale-chunk reload).
const WORKBOX_IGNORES = [
    '**/wasm/**',
    '**/whisper/**',
    // Operator-only studio and the legacy static landing: served as-is, never
    // from the precached SPA shell.
    'recorder.html',
    'landing.html',
    // Icon-generation source (see pwa-assets.config.js).
    'pwa-icon-source.jpeg',
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
                // SPA client routes are served from the precached shell; the
                // denylist keeps real standalone pages and non-shell prefixes
                // (the operator studio, the legacy landing, the pipeline
                // Functions, R2 media and the Whisper assets) on the network.
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [
                    /^\/api\//,
                    /^\/assets\//,
                    /^\/whisper\//,
                    /^\/recorder(\.html)?$/,
                    /^\/landing\.html$/,
                ],
                cleanupOutdatedCaches: true,
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