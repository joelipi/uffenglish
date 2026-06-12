import { resolve } from 'path'
import { existsSync, mkdirSync, cpSync, copyFileSync } from 'fs'
import { defineConfig } from 'vite'
import purgecss from 'vite-plugin-purgecss'

export default defineConfig({
    plugins: [
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
        })
    ],
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
    server: {
        proxy: {
            '/assets/videos/': {
                target: 'https://r2.ultrafastfluency.com',
                changeOrigin: true,
            },
            '/whisper/': {
                target: 'https://r2.ultrafastfluency.com',
                changeOrigin: true,
            },
        },
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
        },
    },
    preview: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
        },
    },
})