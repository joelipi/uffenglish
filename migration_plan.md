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
- `js/app.js` (374 lines) — main application controller: initialization, lesson orchestration
- `js/components/ui.js` (1,464 lines) — UI bridge monolith: DOM manipulation, Zustand writes, HTML generation
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

**Progress snapshot:** 18 of 23 backlog items COMPLETED. `ui.js` shrunk from 1,613 → 1,464 lines. Phase 1 (video wrappers) COMPLETED.

**Remaining Phase 2 work (next actions):**
1. Dead code purge: `buildGrammarDiff` dead copy, `syncTextModeUI`, `animatePointLoss` (~50 lines)
2. Stale import cleanup in `app.js` (`showPlaybackVideo`, `showContinueButton` imported but never called)
3. `hidePreloader` — small, only called from `app.js`
4. `showPlaybackVideo` — called from `answer-pipeline.js` and `handleIncueUI`; `VideoBubble` React component already exists
5. `showContinueButton` — called from `answer-pipeline.js` and `step-loader.web.js`; `ContinueWidgetBubble` React component already exists

### Phase 2.0: Monolith Shrinkage (Low Risk)
*Before tackling complex logic shifts, shrink the monolith by removing dead code and moving pure utilities.*

1. **Dead Code Purge:** Delete functions with no external callers and no functional impact (e.g., `syncTextModeUI`, `animatePointLoss` as their DOM targets are now commented out in `index.html`; `buildGrammarDiff` dead copy at ui.js:268-299).
2. **Stale Import Cleanup:** Remove unused imports from `app.js` (e.g., `showPlaybackVideo`, `showContinueButton` are imported but never called).
3. **Import Cleanup:** Verify `app.js` import block is cleaned up after every `ui.js` deletion to avoid SyntaxErrors on load.

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
| `hidePreloader` | Zustand `isLoaded` → React handles preloader visibility | Immediate | Pending |
| `showHintsAndScroll` / `hideHints` | Zustand `hintsHTML` → React renders hints inline | Immediate | COMPLETED |
| `renderHangmanHint` / `generateHangmanHint` | Zustand `hangmanHint` → React `<HangmanHint>` | Immediate | COMPLETED |
| `showGuestLoginModal` | `initializeApp()` writes `isGuestModalOpen` directly | `app.js` last caller | COMPLETED |
| `showInitializationErrorMessage` | `app.js` writes `criticalErrorMessage` directly | `app.js` last caller | COMPLETED |
| `showCriticalError` / `hideCriticalError` | Called by `showInitializationErrorMessage` | Same as above | COMPLETED |
| `renderFallbackContinueButton` | `ContinueWidgetBubble` is sole path | `answer-pipeline.js` last caller | COMPLETED |
| `createPragmaticsBubbleHTML` | Already in `feedback-renderer.web.js` | N/A | COMPLETED |
| `createStatsBubbleHTML` | Already in `feedback-renderer.web.js` | N/A | COMPLETED |
| `createGrammarDiffHTML` / `buildGrammarDiff` | Active version in `feedback-renderer.web.js`; dead copy still in ui.js:268-299 | Dead code removal | Pending (Phase 2.0) |
| `getPraiseHTML` | Already in `feedback-renderer.web.js`, imported by ui.js | N/A | COMPLETED |
| `renderUserChatMessage` | All callers use `addChatMessage` directly | Various callers | COMPLETED |
| `renderTutorMessage` | All callers use `addChatMessage` directly | Various callers | COMPLETED |
| `showPlaybackVideo` | `<VideoBubble>` is sole React path | `answer-pipeline.js` and `handleIncueUI` last callers; stale import in `app.js` to remove | Pending |
| `showContinueButton` (mid-lesson) | `ContinueWidgetBubble` is sole React path | `answer-pipeline.js` and `step-loader.web.js` last callers; stale import in `app.js` to remove | Pending |
| `removeAILoadingStatus` | Zustand + `<AiLoadingBubble>` | Various callers | COMPLETED |
| `syncTextModeUI` | Dead code — DOM targets commented out in `index.html` | N/A | Pending (Phase 2.0) |
| `animatePointLoss` | Dead code — DOM targets commented out in `index.html` | N/A | Pending (Phase 2.0) |

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
| `initUISubscriptions` | ~68 | Move subscriptions into React `useEffect` hooks |
| `renderSpeechInputUI` / `renderTextInputUI` | ~80 | Zustand for input state → React `<AnswerInput>` component |
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
