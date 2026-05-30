# React Migration Roadmap

## State of the codebase

The app is a **hybrid architecture in active migration** from vanilla JS to React. React 19, React Router 7, Zustand 5, and TanStack Query core are in place. ~58 JSX component files coexist with ~40 vanilla JS modules.

### What's already React
- Chat system (14 bubble components + `ChatInterface.jsx`)
- All widgets (`MicrophoneToggle`, `AnswerInput`, `ScoreBoard`, `ProgressBar`, etc.)
- Modals (`GuestLoginModal`, `CriticalErrorModal`)
- Video wrappers (`InteractiveVideoWrapper`, `VideoProcessorWrapper`, etc.)
- `LessonContainer.jsx` (route component orchestrating 25+ children)

### What's still blocking full React adoption

**1. DOM manipulation (violates AGENTS.md rule)**

| File | Issue |
|------|-------|
| `js/components/interactive-video-player.js` | 360-line class: `createElement`, `appendChild`, `classList`, `innerHTML`, `querySelector` |
| `js/modules/video-processor.web.js` | 428 lines: `querySelector`, `getElementById`, `createElement`, `appendChild` |
| `js/modules/speech.web.js` | `createElement('canvas')`, `createElement('a')`, `body.appendChild` |
| `js/components/SimpleVideoPlayer.web.jsx` | `createElement('video')`, `createElement('canvas')`, `body.appendChild(tempVideo)` |
| `js/modules/video-share.web.js` | `createElement('a')`, `body.appendChild` |

**2. Browser-only imports in shared business logic**

| Module | Hard-imports browser code | Blocks RN reuse |
|--------|--------------------------|-----------------|
| `answer-pipeline.jsx` | `Media`, `warmUpSpeechCamStream`, `chat-interface.js` | ✅ Yes |
| `lesson-progression.js` | `Media`, `addAILoadingMessage`, `getChatHistoryContext` | ✅ Yes |
| `step-loader-execute.js` | `warmUpSpeechCamStream`, `toggleSpeechRecognition`, `clearChat` | ✅ Yes |

**3. Non-reactive values in Zustand store**

12+ callback functions and mutable instances stored as reactive state: `currentVideoPlayer`, `webcamStream`, `answerPipelineDeps`, `tutorChatSubmitCallback`, `onMicClickCallback`, plus 7 input callbacks. Breaks data-flow traceability, causes unnecessary subscriptions.

**4. Small React anti-patterns**

- `StepLoader.jsx`: `dangerouslySetInnerHTML`
- `LessonContainer.jsx`: inline styles instead of CSS classes
- `answer-pipeline.jsx`: dead `import React` and `import { BilingualText }` (both unused), misleading `.jsx` extension
- `MicStatusText.jsx`: renders HTML strings as `dangerouslySetInnerHTML` from `step-loader-execute.js`

**5. Two big DOM files (deferred)**

- `interactive-video-player.js` — full class rewrite
- `video-processor.web.js` — heavy canvas/MediaRecorder pipeline

---

## Work Areas

### A. Deps Injection for Answer Pipeline & Progression
*Detailed in `briefs/deps-injection-answer-pipeline.md`*

Convert `answer-pipeline.jsx`, `lesson-progression.js`, and `step-loader-execute.js` to factory functions that accept all browser-specific dependencies as parameters — same pattern `step-loader-orchestrate.js` already uses. `app-infra.js` becomes the wiring layer.

**Files:** `answer-pipeline.jsx` → `.js`, `lesson-progression.js`, `step-loader-execute.js`, `step-loader.web.js`, `app-infra.js`

### B. Small React Fixes (surface-level)

| Item | File | Fix |
|------|------|-----|
| B1 | `StepLoader.jsx:61` | Replace `dangerouslySetInnerHTML` on `completionMessage` with proper React elements |
| B2 | `LessonContainer.jsx:140-144` | Move inline styles for `chat-window-container` to a CSS class |
| B3 | `answer-pipeline.jsx:17-18` | Remove dead `import React` + `import { BilingualText }`, rename to `.js` |
| B4 | `MicStatusText.jsx` + callers | Convert HTML strings in `setMicStatusText` (from `step-loader-execute.js`) to structured state + React rendering |

### C. Remove Callbacks from Store (follow-up)

After the factories from (A) are wired, the stored callbacks become dead code. Remove in a single cleanup pass.

**Store callbacks to remove:** `answerPipelineDeps`, `loadLessonContentCallback`, `tutorChatSubmitCallback`, `introContinueCallback`, `introAudioOnlyCallback`, `onMicClickCallback`, `speechInputHintCallback`, `speechInputRevealCallback`, `speechInputToggleCallback`, `textInputSubmitCallback`

Also move `currentVideoPlayer` and `webcamStream` from reactive state to module-level refs or React refs.

### D. Big DOM Files (deferred)

- `interactive-video-player.js` — React component rewrite
- `video-processor.web.js` — canvas pipeline refactor

Not started until A-C are complete.

---

## What's intentionally out of scope

| Item | Reason |
|------|--------|
| React Native config files | Not building RN app yet |
| CSS reorganization | Not blocking adoption |
| TypeScript | Explicitly rejected |
| Store splitting into slices | Doesn't advance either goal — flat store works fine |
| Standalone HTML pages | Separate concern, stable as-is |
| `chat-interface.js` conversion | Not dead code; actively used from 4 modules. Works correctly as a plain-JS store wrapper |
