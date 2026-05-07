import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'), // your renamed landing page
                homescreen: resolve(__dirname, 'homescreen.html'),
                login: resolve(__dirname, 'login.html'),
                signup: resolve(__dirname, 'signup.html'),
                lesson: resolve(__dirname, 'lesson.html'),
                userprofile: resolve(__dirname, 'userprofile.html'),
                // add any other HTML files you have here!
            },
        },
    },
})