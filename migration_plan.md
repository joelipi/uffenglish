# React Migration Plan — UFF English

## Current State Summary

The app is a **hybrid architecture in active migration**. React (v19.2.0) has been introduced as a "UI skin" layer using React Portals into a predominantly vanilla JS HTML page. The chat system, score displays, modals, mic button, and lesson layout shell have been successfully migrated to React components driven by a shared Zustand store. However, the **core lesson engine**, **video players**, **step loading**, **CSS**, and **all non-index HTML pages** remain vanilla JS.

### What's Already React (30 `.jsx` files)
- `js/App.jsx` — BrowserRouter, Routes only (portals moved to LessonContainer)
- `js/index.jsx` — React entry point with `createRoot`
- `js/components/lesson/` — 3 shell components (Header, ChatContainer, StatsBar)
- `js/components/chat/` — 10 chat bubble components (ChatInterface, UserBubble, SystemBubble, GrammarDiffBubble, PragmaticsBubble, PraiseBubble, StatsBubble, AiLoadingBubble, VideoBubble, ContinueWidgetBubble)
- `js/components/widgets/` — ScoreBoard, ActivityStats, MicrophoneToggle, MicStatusText, Hints
- `js/components/modals/` — GuestLoginModal, CriticalErrorModal
- `js/components/*Wrapper.jsx` — 4 thin React shells around vanilla video player classes (wired to Zustand)
- `js/components/LessonContainer.jsx` — route component rendering React shell, video wrappers, and portals

### What's Still Vanilla JS
- `js/app.js` (~355 lines) — main application controller: initialization, lesson orchestration
- `js/components/ui.js` (~1,029 lines) — UI bridge monolith: DOM manipulation, Zustand writes, HTML generation
- `js/components/step-loader.web.js` (446 lines) — step loading orchestration (deliberately kept vanilla)
- `js/components/interactive-video-player.js` (359 lines), `simple-video-player.js` (401 lines), `intro-background-video.js` (97 lines) — video player classes
- `js/components/feedback-renderer.web.js`, `point-loss-animation.js`, `mic-animation.js`, `success-lesson.js` — utility modules
- All standalone HTML pages: `homescreen.html`, `login.html`, `signup.html`, `userprofile.html`, `recover-password.html`, `reset-password.html`
- `js/modules/answer-pipeline.js` (442 lines) — answer processing, calls ui.js functions
- `js/modules/lesson-progression.js` (106 lines) — step transitions, calls ui.js functions

### Key Architecture Facts
- **State bridge:** Zustand vanilla store (`js/modules/store.js`) with persist middleware — serves as shared state between vanilla JS and React
- **Routing:** `react-router-dom` v7. Active; route changes are signaled via `hybridRouteChange` custom events from React to vanilla JS. URL format: `/course/:courseId/lesson/:lessonId`
- **CSS:** Inline `<style>` blocks per HTML file. Bootstrap 5.3.3 from CDN.
- **Entry point:** Both `js/app.js` and `js/index.jsx` load as separate `<script type="module">` tags in `index.html`
- **Build:** Vite 8.0.10, multi-page build with 5 HTML entry points

---

## Key Decisions

- **Keep vanilla JS in wrappers** — video players, step-loader, animations, ui.js bridge stay as vanilla classes wrapped by React.
- **`step-loader.web.js` stays vanilla** — `_renderResponseStep` wires up 15+ imperative speech-recognition callbacks that manipulate DOM by ID. Converting requires rewriting `speech.js` too. Not worth the risk mid-migration.
- **`landing.html` stays as standalone** marketing page — not migrated to React.
- **Stop shuffling vanilla code** — every change must either (A) delete something React supersedes, (B) add a Zustand action React can consume, or (C) replace a ui.js function with a React component.
- **Zustand is the bridge** — functions that write to Zustand produce state that React components consume. Functions that manipulate DOM directly are the target for elimination.

---

## Bugs Fixed During Active Development

| Bug | Root Cause | Fix |
|-----|-----------|------|
| AI tutor chat not rendering | `renderTutorMessage()` wrote HTML directly instead of pushing to Zustand | Changed to `addChatMessage()` — React renders from Zustand |
| `AiLoadingBubble` showing HTML tags as text | JSX auto-escapes, `Strings.get()` returns HTML with `<br>`/`<span>` | `dangerouslySetInnerHTML` |
| Stale "FluIntel AI" loading bubble after openResponse answer | `renderAIAnalysisLoading()` at line 565 with no matching `removeAILoadingStatus()` | Removed the call |
| Double-escaped HTML entities | `escapeHTML()` + React auto-escape | Removed `escapeHTML()` from `renderUserChatMessage` |
| Chat message list not scrollable | `#react-root-chat` broke flex chain | Added `flex: 1; min-height: 0` CSS |
| App not clickable with DevTools open + video not pausing | `will-change` on `.ivp-main-wrapper` created Chrome compositing layer intercepting input | Removed `will-change`; set `#chat-window-container` z-index: 11 |
| Continue button click did nothing | `_deps` param at wrong position in wrapper spread | Moved `_deps` before `userData`/`configData`/`courseId` in function signature |
| Preflight error text invisible in micstatus | `ui.js` directly set `DOM.micStatusText.innerHTML`, destroying React portal's `#micStatusText` node — after that React could never re-render content into the portal | Removed all 4 `DOM.micStatusText.innerHTML` writes from `ui.js` (`showMicWarning`, `resetMicStatusWithStep`, `clearMicStatusAndHideMedia`, `renderWhisperReviewUI`); React now exclusively owns micstatus DOM via Zustand + portal |

---

## Migration Strategy

**Goal A:** Migrate to React.  
**Goal B:** Separate DOM manipulation from logic.

**Principle:** Every action must directly advance one of these goals. No more code shuffling. Each step either:

1. **Deletes** something React already handles (zero risk, instant win)
2. **Adds a Zustand action** that React can consume directly (expands the bridge)
3. **Replaces a ui.js function** with a Zustand write + React component (eliminates DOM coupling)

---

## Phase 1: Wire Video Wrappers to Zustand — COMPLETED

*Video wrapper components existed but were inert. Wired them so React controls video lifecycle. Pure React gain — no ui.js involvement.*

| Step | Description | Status |
|------|-------------|--------|
| 1.1 | Add `currentVideo` to Zustand store | COMPLETED |
| 1.2 | `loadVideoForStep()` writes to Zustand via `setCurrentVideo()` | COMPLETED |
| 1.3 | `InteractiveVideoWrapper` reads Zustand via `useSyncExternalStore` → mounts/destroys player instance | COMPLETED |
| 1.4 | Same for `SimpleVideoWrapper`, `IntroVideoWrapper`, `VideoProcessorWrapper` | COMPLETED |
| 1.5 | Remove now-dead DOM code from `ui.js` (`clearPlaybackVideo`, `setupPlaybackVideo`, `prepareMediaUI`, parts of `showPlaybackVideo`) | Pending — some still called from `handleIncueUI` and `answer-pipeline.js` |

---

## Phase 2: Replace ui.js Functions with Zustand + React (Ongoing)

*For each remaining ui.js function, add a Zustand action + React component that replaces it, then delete the old function. This is a single loop — replacement unblocks deletion, deletion is the completion signal.*

**Progress snapshot:** All Phase 2 backlog items COMPLETED. `ui.js` shrunk from 1,613 → ~1,029 lines. Phase 1 (video wrappers) COMPLETED. Phase 2.0 (monolith shrinkage) COMPLETED. Phase 2.1 (bottom controls state machine) COMPLETED. Phase 2.2 (hidePreloader) COMPLETED. Phase 2.3 (showPlaybackVideo) COMPLETED. Phase 2.4 (initUISubscriptions chat header) COMPLETED. Phase 2.5 (renderSpeechInputUI/renderTextInputUI) COMPLETED.

**Bug fixes since last update:**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Answer input area visible immediately on step load | `step-loader` called `setTextInputVisible(true)` when step loaded; original `renderTextInputUI` kept input hidden by default | Removed `setTextInputVisible(true)` from both `step-loader` call sites; input only appears when user clicks `#txtBtn` |
| Answer input area in wrong position | Layout classes (`position-absolute w-100 p-3 z-3`) removed from `#answer-input-area` during refactor, breaking `top: 220px` CSS | Restored classes on `#answer-input-area` div; removed duplicates from portal inner content |
| `#txtBtn` click had no effect (input stayed hidden) | `#answer-input-area` had `class="d-none"` but `AnswerInput.jsx` only toggled inner content display, not the outer div's `d-none` class | Added `useEffect` in `AnswerInput.jsx` to toggle `d-none` on portal target; gutted competing `initUISubscriptions` txtBtn handler |
| Answer input retained text from previous step | Original `renderTextInputUI` cleared textarea; React version never did | Added `useEffect` in `AnswerInput.jsx` that clears textarea when `textInputSubmitCallback` changes |
| Dark overlay covering answer input on paused simpleVideo | `#answer-input-area` had `z-index: 3` but `.ivp-play-overlay` had `z-index: 10` | Added `z-index: 20 !important` to `#answer-input-area` CSS |
| Hints appearing behind video overlay and mispositioned | `#react-root-hints` missing `position-absolute` class and z-index; CSS rule targeted old `#hints` ID | Updated CSS selector to `#react-root-hints`, added `position-absolute` class and `z-index: 20` |
| Stats container hidden after step load | Original `renderTextInputUI` called `DOM.statsContainer.classList.remove('d-none')`; this was lost in migration | Added `appStore.getState().setStatsVisible(true)` and `updateProgressAndCloseButton(false)` in `step-loader` for text/response steps |
| Preflight warnings never auto-hiding | `onStopEarly`, `onGibberishDetected` handlers showed warnings but never cleared them; `onGibberishDetected` also didn't re-show mic button | Added `_clearWarningLater(ms)` timeouts (3-4s) to auto-clear warnings; `_cancelWarningClear()` in `onRecordingStart` prevents clearing the "speak now" message |
| Progress bar not updating | `ProgressBar.jsx` appended `'%'` to values already containing `%`, producing invalid `width: "95%%"` | Added format check: if value already ends with `%`, use as-is |
| Progress bar visible but empty (no fill) | Portal target `#react-root-progress` wrapper div broke Bootstrap's `.progress` > `.progress-bar` flex layout | Removed `#react-root-progress` wrapper; portal now renders directly into `#progress` (the Bootstrap `.progress` container) |

**Remaining work:**
1. Phase 4 heavy functions: `handlecueUI`, `handleIncueUI`, `renderWhisperReviewUI`/whisper chain, `initTutorChatUI`/`showTutorChatInput`/`hideTutorChatInput`, webcam functions
2. `renderSpeechInputUI` deleted from `ui.js`; its answer-content rendering (pulse-dot hints) is handled by Zustand `speechInputContent` but not yet rendered visually by `Hints.jsx` — only click handlers are wired in `AnswerInput.jsx`
3. `initUISubscriptions` is now a no-op; can be fully deleted when all callers are cleaned up

### Phase 2.3: showPlaybackVideo → VideoBubble — COMPLETED

*Replaced `showPlaybackVideo()` (~55 lines) with direct Zustand chat message pushes. `VideoBubble.jsx` now handles all video wrapper DOM manipulation + playback.*

- `answer-pipeline.js` and `ui.js handleIncueUI`: replaced `showPlaybackVideo()` with `addChatMessage({ type: 'video' })` + duplicate guard (if video bubble already exists, just resume play)
- `VideoBubble.jsx`: added video element style setup + `video.play()` on mount
- Deleted `showPlaybackVideo` from `ui.js`

### Phase 2.2: hidePreloader → React — COMPLETED

*Replaced `hidePreloader()` (~5 lines) with Zustand write + React useEffect.*

- `app.js`: replaced `hidePreloader()` calls with `appStore.getState().setIsLoaded(true)`
- `LessonContainer.jsx`: added `useEffect` that reads `isLoaded` and hides `#appLoadingImageDiv`
- Deleted `hidePreloader` from `ui.js`; removed import from `app.js`

### Phase 2.1: Bottom Controls State Machine — COMPLETED

*Replace `showContinueButton`, `hideContinueButton`, `showLessonSuccessState`, and `syncTextModeUI` with a Zustand-driven three-state system for the bottom controls area.*

**Bug being fixed:** `#state-standard-mic` (rendered by React `MicrophoneToggle` portal) is invisible but takes up space during lesson intro because vanilla JS adds `d-none` to a React-owned element, but React's rendering overrides it. The intro choices (`#state-intro-choices`) appear alongside the ghost mic wrapper instead of replacing it.

**Current behavior (vanilla):** The `controls-section` in `index.html` has 3 mutually-exclusive center states:
1. `#state-standard-mic` (default) — mic button, now rendered by React portal into `#react-root-mic`
2. `#state-intro-choices` (lesson intro) — Video/Audio/Text choice buttons, hardcoded in `index.html`
3. `#state-lesson-success` (lesson end) — Create Video button, hardcoded in `index.html`

Vanilla JS toggles these by adding/removing `d-none` on DOM elements, which fights with React's portal rendering.

**Migration steps:**

| Step | Description |
|------|-------------|
| 2.1.1 | Add `bottomControlState` to Zustand store — string enum: `'mic'` \| `'introChoices'` \| `'lessonSuccess'` (default: `'mic'`). Add `setBottomControlState` action. |
| 2.1.2 | Update `MicrophoneToggle.jsx` — read `bottomControlState`; add `d-none` class when state is not `'mic'`. This fixes the invisible-but-taking-space bug. |
| 2.1.3 | Create `IntroChoices.jsx` — React component rendered into `#react-root-mic` (or alongside it); reads `bottomControlState`; shows Video/Audio/Text buttons when `'introChoices'`; on click, writes `isTextMode`/`isCameraOff` to Zustand and calls the stored callback. |
| 2.1.4 | Handle `LessonSuccessControls` — read `bottomControlState`; show success UI when `'lessonSuccess'`. Can be a separate component or part of `MicrophoneToggle` conditional rendering. |
| 2.1.5 | Replace callers: `answer-pipeline.js` `showContinueButton(...)` → write `bottomControlState: 'introChoices'` to store + store callback; `hideContinueButton()` → write `bottomControlState: 'mic'` + `removeContinueWidget()`. `success-lesson.js` `showLessonSuccessState()` → write `bottomControlState: 'lessonSuccess'`. |
| 2.1.6 | Delete from `ui.js`: `showContinueButton` (~64 lines), `hideContinueButton` (~12 lines), `showLessonSuccessState` (~7 lines), `syncTextModeUI` (~22 lines). Remove stale imports from `step-loader.web.js` and `answer-pipeline.js`. |
| 2.1.7 | Remove hardcoded `#state-intro-choices` and `#state-lesson-success` divs from `index.html` (now React-rendered). |
| 2.1.8 | Ensure `resetUIForNewStep` resets `bottomControlState` to `'mic'` when a new step loads. |
| 2.1.9 | Run full test suite. |

**Net result:** ~105 lines deleted from `ui.js`. MicrophoneToggle visibility fully React-controlled. Three-state bottom controls driven entirely by Zustand. `syncTextModeUI` dead code eliminated.

### Phase 2.0: Monolith Shrinkage — COMPLETED

*Shrunk the monolith by removing dead code, dead copies, and stale imports.*

1. **Dead Code Purge:** Removed `animatePointLoss` (no callers) and `buildGrammarDiff` dead copy (active version lives in `feedback-renderer.web.js`).
2. **Stale Import Cleanup:** Removed 27 unused imports from `app.js` — only 7 of 34 ui.js imports were actually used (`DOM`, `initTutorChatUI`, `setupLessonUI`, `initUISubscriptions`, `hidePreloader`, `resetMissionText`, `initMissionToggle`).
3. **Import Cleanup:** Verified `app.js` import block is clean after deletions; updated `showMicWarning` unit test to check Zustand store instead of DOM (React portal owns DOM now).

**Per-function process:**
1. Add state to Zustand (the data, not the DOM)
2. React component reads Zustand and renders the UI
3. Vanilla function either writes to Zustand or is replaced
4. Delete the old ui.js function

**Backlog ordered by complexity:**

| Function | Replace With | Unblocked When | Status |
|----------|-------------|----------------|---------|
| `setProgressBarWidth` | Zustand `progressPercent` → React `<ProgressBar>` | Immediate | COMPLETED |
| `toggleStatsContainer` | Zustand `statsVisible` → React `StatsBar` reads it | Immediate | COMPLETED |
| `setMicStatusText` | Zustand `micStatusText` → React `<MicStatusText>` | Immediate | COMPLETED |
| `setMicStatusText` innerHTML writes | Removed direct `DOM.micStatusText.innerHTML` from 4 ui.js functions — React portal now exclusively owns micstatus DOM | Just fixed | COMPLETED |
| `hidePreloader` | Zustand `isLoaded` → React `LessonContainer` hides preloader | `app.js` last caller | COMPLETED |
| `showHintsAndScroll` / `hideHints` | Zustand `hintsHTML` → React renders hints inline | Immediate | COMPLETED |
| `renderHangmanHint` / `generateHangmanHint` | Zustand `hangmanHint` → React `<HangmanHint>` | Immediate | COMPLETED |
| `showGuestLoginModal` | `initializeApp()` writes `isGuestModalOpen` directly | `app.js` last caller | COMPLETED |
| `showInitializationErrorMessage` | `app.js` writes `criticalErrorMessage` directly | `app.js` last caller | COMPLETED |
| `showCriticalError` / `hideCriticalError` | Called by `showInitializationErrorMessage` | Same as above | COMPLETED |
| `renderFallbackContinueButton` | `ContinueWidgetBubble` is sole path | `answer-pipeline.js` last caller | COMPLETED |
| `createPragmaticsBubbleHTML` | Already in `feedback-renderer.web.js` | N/A | COMPLETED |
| `createStatsBubbleHTML` | Already in `feedback-renderer.web.js` | N/A | COMPLETED |
| `createGrammarDiffHTML` / `buildGrammarDiff` | Active version in `feedback-renderer.web.js`; dead copy removed from ui.js | N/A | COMPLETED |
| `getPraiseHTML` | Already in `feedback-renderer.web.js`, imported by ui.js | N/A | COMPLETED |
| `renderUserChatMessage` | All callers use `addChatMessage` directly | Various callers | COMPLETED |
| `renderTutorMessage` | All callers use `addChatMessage` directly | Various callers | COMPLETED |
| `showPlaybackVideo` | `<VideoBubble>` handles DOM + video play; callers push `type: 'video'` chat message directly | `answer-pipeline.js` and `handleIncueUI` last callers | COMPLETED |
| `showContinueButton` / `hideContinueButton` / `showLessonSuccessState` | Zustand `bottomControlState` → React `<IntroChoices>` + `MicrophoneToggle` reads it | `answer-pipeline.js` and `success-lesson.js` last callers | COMPLETED |
| `removeAILoadingStatus` | Zustand + `<AiLoadingBubble>` | Various callers | COMPLETED |
| `syncTextModeUI` | Only called from `showContinueButton` — deleted with it | N/A | COMPLETED |
| `animatePointLoss` | No callers — removed | N/A | COMPLETED |

**When to stop simple replacements:** Once only `handlecueUI`, `handleIncueUI`, and the webcam/whisper chain remain — these become Phase 4.

---

## Phase 3: HTML Pages → React Routes (~2-3 hours)

*Convert standalone HTML pages to React components. Self-contained, easy to verify.*

| Step | Description |
|------|-------------|
| 3.1 | Convert Vite multi-page build to SPA (single `index.html` entry) |
| 3.2 | Migrate `homescreen.html` → `<HomeScreen>` |
| 3.3 | Migrate auth pages (`login.html`, `signup.html`, `userprofile.html`, `recover-password.html`, `reset-password.html`) |
| 3.4 | SKIP — `landing.html` stays standalone |
| 3.5 | Delete old HTML files, update Vite config |
| 3.6 | Remove `hybridRouteChange` event listener from `app.js` (routing fully owned by React) |

---

## Phase 4: Heavy Functions (Last Resort)

*Tackle the remaining ui.js monoliths. Only start this after Phases 1-3 have eliminated everything else.*

| Function | Lines | Strategy |
|----------|-------|----------|
| `handlecueUI` | ~96 | Extract Zustand writes → React components for each section. Keep DOM construction as vanilla if needed. |
| `handleIncueUI` | ~105 | Same approach. |
| `renderWhisperReviewUI` / whisper chain | ~70 | Zustand for whisper state → React component for UI |
| `initUISubscriptions` | ~68 | Move subscriptions into React `useEffect` hooks | COMPLETED (now no-op) |
| `renderSpeechInputUI` / `renderTextInputUI` | ~80 | Zustand for input state → React `<AnswerInput>` component | COMPLETED
| `initTutorChatUI` / `showTutorChatInput` / `hideTutorChatInput` | ~40 | React component manages visibility |
| Webcam functions | ~60 | Zustand for webcam state → React manages `<video>` element |

**Final state:** `ui.js` deleted. All DOM manipulation lives either in React components or in deliberate vanilla wrapper classes (video players, animations).

---

## Phase 5: `/course/:courseId/lesson/:lessonId` Cleanup

- Remove `app.js` `<script>` tag from `index.html`
- `app.js` logic moves to React `useEffect` in LessonContainer
- Single entry point: `js/index.jsx`

---

## Risk Considerations

- **Highest value for lowest risk:** Phase 2.0 dead code purge (pure deletion, zero behavior change)
- **Next easiest wins:** `showPlaybackVideo` / `showContinueButton` — React components already exist, just need to delete the old ui.js functions and redirect callers
- **Most repetitive:** Phase 2 (each function is a small self-contained replacement)
- **Self-contained:** Phase 3 (HTML pages don't share state with the lesson engine)
- **Riskiest:** Phase 4 (`handlecueUI`/`handleIncueUI` are critical paths)

## Completion Criteria

1. `ui.js` deleted — all DOM manipulation in React components or deliberate vanilla wrappers
2. `index.html` is the SPA entry point; `landing.html` stays standalone
3. Video players remain as vanilla JS classes wrapped in React components
4. Zustand store is the single source of truth — no `window` property bridges
5. All `dangerouslySetInnerHTML` eliminated (except trusted static content)
6. All routes work via React Router in a single-page application
7. The app is fully functional at each step — no regressions between phases
