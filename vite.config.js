import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
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