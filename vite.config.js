import { resolve } from 'path'
import { defineConfig } from 'vite'
import purgecss from 'vite-plugin-purgecss'

export default defineConfig({
    plugins: [
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
                homescreen: resolve(__dirname, 'homescreen.html'),
                login: resolve(__dirname, 'login.html'),
                signup: resolve(__dirname, 'signup.html'),
                userprofile: resolve(__dirname, 'userprofile.html'),
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