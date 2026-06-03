import { resolve } from 'path'
import { existsSync, mkdirSync, cpSync } from 'fs'
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