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
- [ ] `js/modules/feedback-builder.js`
- [ ] `js/modules/idiom-checker.js`
- [ ] `js/modules/lesson-router.js`
- [ ] `js/modules/normalize.js`
- [ ] `js/modules/scoring.js`
- [ ] `js/modules/state.js`
- [ ] `js/modules/store.js`
- [ ] `js/modules/swearjar.js`
- [ ] `js/modules/utils.js`
- [ ] `js/modules/video-controller.js`
- [ ] `js/modules/video-processor-logic.js`

## 📁 Group B: The Storage & Profile Adapters
These files handle data persistence and have been abstracted so they do not crash when `localStorage` is unavailable.

- [ ] `js/modules/user-profile.js`
- [ ] `js/modules/storage-adapter.js` *(New bridge file)*

## 📁 Group C: Web-Only Platform Handlers
These files handle HTML5 video, Web Audio, and browser DOM APIs. They are strictly for the web build. *(You will build `.native.js` counterparts for the app later).*

- [ ] `js/modules/speech.web.js`
- [ ] `js/modules/media.web.js`
- [ ] `js/modules/storage.web.js`
- [ ] `js/modules/video-loader.web.js`
- [ ] `js/modules/video-processor.web.js`
- [ ] `js/modules/video-share.web.js`
- [ ] `js/workers/whisper/app-vad-asr-web.js`
- [ ] `js/workers/whisper/whisper-worker-web.js`
- [ ] `js/workers/nlp-worker-web.js`

- [ ] `lesson.html` (The file where all the lessons take place.)
- [ ] `homescreen.html` (The "welcome" or "main" screen where a user can choose a lesson and access menus.)

- [ ] `index.html` (This is not part of the app at all. It is a draft landing page or index.html page for the website to promote the app.)

The following files were created for while testing. They will be replaced or restyled.

- [ ] `login.html`
- [ ] `signup.html`
- [ ] `userprofile.html`
- [ ] `recover-password.html`
- [ ] `reset-password.html`

## 📁 Group D: Web-Only UI Components
These are visual renderers using HTML/CSS. They will be entirely replaced by Native UI components in the mobile app, so they remain as-is for the web version.

- [ ] `js/components/ui.js`
- [ ] `js/components/interactive-video-player.js`
- [ ] `js/components/intro-background-video.js`
- [ ] `js/components/point-loss-animation.js`
- [ ] `js/components/simple-video-player.js`
- [ ] `js/components/success-lesson.js`
- [ ] `js/components/feedback-renderer.web.js`
- [ ] `js/components/step-loader.web.js`

## 📁 Group E: React Native Only platform handlers
- [ ] `js/components/interactive-video-player.native.jsx`
- [ ] `js/components/simple-video-player.native.jsx`
- [ ] `js/modules/media.native.js`
- [ ] `js/modules/video-processor-native.jsx`

## 📁 Group F: Data / Config
- [ ] `js/data/praise.js`
- [ ] `js/data/strings.js`
- [ ] `js/data/idioms.json`
- [ ] `js/data/idioms_original_with_blind_lemmatization.json`
- [ ] `js/config/gt2.json`

## 📁 Group G: Metro Resolvers (.js files that resolve to .web.js or .native.js / .native.jsx)
- [ ] `js/modules/media.js`
- [ ] `js/modules/speech.js`
- [ ] `js/modules/storage.js`
- [ ] `js/modules/video-loader.js`
- [ ] `js/modules/video-processor.js`
- [ ] `js/modules/video-share.js`
- [ ] `js/components/feedback-renderer.js`
- [ ] `js/components/step-loader.js`

## 📁 The Orchestrator
This file bridges the pure logic and the web UI.

- [ ] `js/app.js`

## 📁 Archived / For Future Use
- [ ] `js/modules/FORFUTUREUSEnlp-coordinator.js`

## 📁 Complete File Tree
```text
.
├── README.md
├── agents.md
├── assets
│   ├── fonts
│   │   ├── fira-code
│   │   │   └── FiraCode-VariableFont_wght.woff2
│   │   └── manrope
│   │       └── Manrope-VariableFont_wght.woff2
│   ├── img
│   │   ├── ai-avatar.png
│   │   ├── bulb.svg
│   │   ├── continue.png
│   │   ├── continue.svg
│   │   ├── cropped-teacher.png
│   │   ├── exercise-brain.avif
│   │   ├── favicons
│   │   │   ├── apple-touch-icon.jpeg
│   │   │   ├── favicon-192x192.jpeg
│   │   │   └── favicon-32x32.jpeg
│   │   ├── header.png
│   │   ├── micoff.svg
│   │   ├── micon.svg
│   │   ├── mobileheaderhalf.png
│   │   ├── party-brain.webp
│   │   ├── teacherprofile.png
│   │   ├── u-f-f.png
│   │   ├── verygood01.png
│   │   ├── verygood02.png
│   │   ├── verygood03.png
│   │   └── videoThumbnail.png
│   └── sounds
│       ├── complete-old.mp3
│       ├── complete-zing.mp3
│       ├── complete.mp3
│       ├── correct-old.mp3
│       ├── correct.mp3
│       ├── enableaudio.mp3
│       ├── incorrect-old.mp3
│       └── incorrect.mp3
├── engine
│   ├── engine.js
│   ├── package.json
│   └── test.js
├── file-manifest.md
├── homescreen.html
├── index.html
├── js
│   ├── app.js
│   ├── components
│   │   ├── feedback-renderer.js
│   │   ├── feedback-renderer.web.js
│   │   ├── interactive-video-player.js
│   │   ├── interactive-video-player.native.jsx
│   │   ├── intro-background-video.js
│   │   ├── point-loss-animation.js
│   │   ├── step-loader.js
│   │   ├── step-loader.web.js
│   │   ├── simple-video-player.js
│   │   ├── simple-video-player.native.jsx
│   │   ├── success-lesson.js
│   │   └── ui.js
│   ├── config
│   │   └── gt2.json
│   ├── data
│   │   ├── idioms.json
│   │   ├── idioms_original_with_blind_lemmatization.json
│   │   ├── praise.js
│   │   └── strings.js
│   ├── modules
│   │   ├── FORFUTUREUSEnlp-coordinator.js
│   │   ├── analytics.js
│   │   ├── answers.js
│   │   ├── api.js
│   │   ├── appwrite.js
│   │   ├── calculate-similarity.js
│   │   ├── complexity.js
│   │   ├── config-normalizer.js
│   │   ├── feedback-builder.js
│   │   ├── idiom-checker.js
│   │   ├── lesson-router.js
│   │   ├── media.js
│   │   ├── media.native.js
│   │   ├── media.web.js
│   │   ├── normalize.js
│   │   ├── scoring.js
│   │   ├── speech.js
│   │   ├── speech.web.js
│   │   ├── state.js
│   │   ├── storage-adapter.js
│   │   ├── storage.js
│   │   ├── storage.web.js
│   │   ├── store.js
│   │   ├── swearjar.js
│   │   ├── user-profile.js
│   │   ├── utils.js
│   │   ├── video-controller.js
│   │   ├── video-loader.js
│   │   ├── video-loader.web.js
│   │   ├── video-processor-logic.js
│   │   ├── video-processor-native.jsx
│   │   ├── video-processor.js
│   │   ├── video-processor.web.js
│   │   ├── video-share.js
│   │   └── video-share.web.js
│   └── workers
│       ├── nlp-worker-web.js
│       └── whisper
│           ├── app-vad-asr-web.js
│           └── whisper-worker-web.js
├── lesson.html
├── login.html
├── package-lock.json
├── package.json
├── playwright.config.js
├── recover-password.html
├── reset-password.html
├── signup.html
├── style.css
├── temp_video_share.js
├── tests
│   └── example.spec.js
├── tree.txt
├── userprofile.html
└── vite.config.js
```
