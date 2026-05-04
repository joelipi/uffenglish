# UFF English - File Architecture Manifest

This manifest outlines the decoupled architecture for the `js/` directory, preparing the application for transition to React Native while maintaining full vanilla web functionality.

## 📁 Group A: "Pure Logic" Core (Platform-Agnostic)
These files contain zero DOM, browser, or hardware dependencies. They are ready to be used in both the Vanilla JS web app and the future React Native app.

- [ ] `js/modules/analytics.js`
- [ ] `js/modules/answers.js`
- [ ] `js/modules/api.js`
- [ ] `js/modules/appwrite.js` *(Note: requires changing CDN to `npm` import when using Vite/React Native)*
- [ ] `js/modules/calculate-similarity.js`
- [ ] `js/modules/complexity.js` *(Note: requires changing CDN to `npm` import when using Vite/React Native)*
- [ ] `js/modules/config-normalizer.js`
- [ ] `js/modules/idiom-checker.js`
- [ ] `js/modules/lesson-router.js`
- [ ] `js/modules/normalize.js`
- [ ] `js/modules/praise.js`
- [ ] `js/modules/scoring.js`
- [ ] `js/modules/state.js`
- [ ] `js/modules/store.js`
- [ ] `js/modules/swearjar.js`
- [ ] `js/modules/utils.js`

## 📁 Group B: The Storage & Profile Adapters
These files handle data persistence and have been abstracted so they do not crash when `localStorage` is unavailable.

- [ ] `js/modules/user-profile.js`
- [ ] `js/modules/storage-adapter.js` *(New bridge file)*

## 📁 Group C: Web-Only Platform Handlers
These files handle HTML5 video, Web Audio, and browser DOM APIs. They are strictly for the web build. *(You will build `.native.js` counterparts for the app later).*

- [ ] `js/modules/speech-web.js` *(Renamed from speech.js)*
- [ ] `js/modules/media-web.js` *(Renamed from media.js)*
- [ ] `js/modules/storage-web.js` *(Renamed from storage.js)*
- [ ] `js/modules/video-loader-web.js` *(Renamed)*
- [ ] `js/modules/video-processor-web.js` *(Renamed)*
- [ ] `js/modules/video-share-web.js` *(Renamed)*
- [ ] `js/modules/whisper/app-vad-asr-web.js` *(Renamed)*
- [ ] `js/modules/whisper/whisper-worker-web.js` *(Renamed)*
- [ ] `js/nlp-worker-web.js` *(Renamed)*

## 📁 Group D: Web-Only UI Components
These are visual renderers using HTML/CSS. They will be entirely replaced by Native UI components in the mobile app, so they remain as-is for the web version.

- [ ] `js/components/ui.js`
- [ ] `js/components/interactive-video-player.js`
- [ ] `js/components/intro-background-video.js`
- [ ] `js/components/point-loss-animation.js`
- [ ] `js/components/simple-video-player.js`
- [ ] `js/components/success-lesson.js`

## 📁 The Orchestrator
This file bridges the pure logic and the web UI.

- [ ] `js/app.js`