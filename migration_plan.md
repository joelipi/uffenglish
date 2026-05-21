# React Migration Plan — UFF English

## Current State Summary

The app is a **hybrid architecture in active migration**. React (v19.2.0) has been introduced as a "UI skin" layer using React Portals into a predominantly vanilla JS HTML page. The chat system, score displays, modals, mic button, and now the lesson layout shell have been successfully migrated to React components driven by a shared Zustand store. However, the **core lesson engine**, **video players**, **step loading**, **CSS**, and **all non-index HTML pages** remain vanilla JS.

### What's Already React (28 `.jsx` files)
- `js/App.jsx` — BrowserRouter, Routes only (portals moved to LessonContainer)
- `js/index.jsx` — React entry point with `createRoot`
- `js/components/lesson/` — 3 shell components (Header, ChatContainer, StatsBar)
- `js/components/chat/` — 10 chat bubble components (ChatInterface, UserBubble, SystemBubble, GrammarDiffBubble, PragmaticsBubble, PraiseBubble, StatsBubble, AiLoadingBubble, VideoBubble, ContinueWidgetBubble)
- `js/components/widgets/` — ScoreBoard, ActivityStats, MicrophoneToggle
- `js/components/modals/` — GuestLoginModal, CriticalErrorModal
- `js/components/*Wrapper.jsx` — 4 thin React shells around vanilla video player classes
- `js/components/LessonContainer.jsx` — route component rendering React shell, video wrappers, and portals

### What's Still Vanilla JS
- `js/app.js` (~1017 lines) — main application controller: initialization, lesson orchestration, answer handling, scoring, progress
- `js/components/ui.js` (1613 lines, 66KB) — UI bridge monolith: DOM manipulation, Zustand writes, HTML generation
- `js/components/step-loader.web.js` (446 lines) — step loading orchestration (deliberately kept vanilla)
- `js/components/interactive-video-player.js` (359 lines), `simple-video-player.js` (401 lines), `intro-background-video.js` (97 lines) — video player classes
- `js/components/feedback-renderer.web.js`, `point-loss-animation.js`, `mic-animation.js`, `success-lesson.js` — utility modules
- All standalone HTML pages: `homescreen.html`, `login.html`, `signup.html`, `userprofile.html`, `recover-password.html`, `reset-password.html`

### Key Architecture Facts
- **State bridge:** Zustand vanilla store (`js/modules/store.js`) with persist middleware — serves as shared state between vanilla JS and React
- **Routing:** `react-router-dom` v7. Active; route changes are signaled via `hybridRouteChange` custom events from React to vanilla JS. URL format: `/course/:courseId/lesson/:lessonId`
- **URL resolution:** `initializeApp()` and `initializeLesson()` in `app.js` read `courseId`/`lessonId` from URL pathname first, fall back to query params, then Zustand/localStorage. Stale query params stripped via `history.replaceState`.
- **CSS:** Inline `<style>` blocks per HTML file. No `style.css` exists. Bootstrap 5.3.3 from CDN.
- **Entry point:** Both `js/app.js` and `js/index.jsx` load as separate `<script type="module">` tags in `index.html`
- **Build:** Vite 8.0.10, multi-page build with 5 HTML entry points

---

## Key Decisions

- **Keep vanilla JS in wrappers** — video players, step-loader, animations, `ui.js` bridge stay as vanilla classes wrapped by React.
- **`step-loader.web.js` stays vanilla** — `_renderResponseStep` wires up 15+ imperative speech-recognition callbacks that manipulate DOM by ID. Converting requires rewriting `speech.js` too. Not worth the risk mid-migration.
- **URL format:** `/course/:courseId/lesson/:lessonId`. Fallback route `*` → Navigate to `/course/gt2/lesson/a`.
- **`landing.html` stays as standalone** marketing page — not migrated to React.
- **`z-index` stacking:** `#chat-window-container` = 11, `.bottom-overlay` = 1050 (pointer-events: none), `.ivp-play-overlay` = 10.
- **React auto-escapes** — `renderUserChatMessage` no longer calls `escapeHTML()`. Double-escaping caused `&#39;` to display literally.

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

---

## Phased Migration Roadmap

### Phase 1: Foundation Cleanup
Skipped or deferred. CSS consolidation deferred to after components exist (Phase 6). Other HTML pages handled in Phase 5. Audit of unused code deferred.

---

### Phase 2: Lesson Body Reactification ✅ COMPLETE

*The core migration. Heavy DOM manipulation stays vanilla; React provides the shell.*

| Step | Status | Notes |
|------|--------|-------|
| 2.1 LessonContainer shell | ✅ | Header, StatsBar, ChatContainer, ports to existing React components |
| 2.2 Verify components in shell | ✅ | 6 portal components confirmed via Playwright test |
| 2.3 Video wrappers in shell | ✅ | 4 wrappers added to LessonContainer JSX, inert until Phase 4 |
| 2.4 step-loader stays vanilla | ✅ | Documented rationale at top of `step-loader.web.js` |
| 2.5 Test hybrid flow | ✅ | React shell + vanilla step-loader + Zustand bridge verified |
| 2.6 Remove STOPGAPs | 🚫 **CANCELLED** | Functions (`resolveCurrentLessonId`, `getNextStep`, etc.) are still actively called. Will be removed when route resolution is fully owned by React (Phase 5). |

**Key files created/modified:**
- `js/components/LessonContainer.jsx` — shell with all portal components
- `js/components/lesson/Header.jsx`, `ChatContainer.jsx`, `StatsBar.jsx` — shell wrappers
- `js/App.jsx` — simplified, no portals
- `js/app.js` — path-based URL resolution added
- `tests/phase2-verify.spec.js` — portal mount verification
- `tests/phase2-hybrid.spec.js` — hybrid flow verification

---

### Phase 3: `app.js` Refactor (NEW PRIORITY)

*`js/app.js` is 1017 lines handling initialization, answer pipeline, scoring, progress, event listeners, and STOPGAP duplicates. Split into focused modules before deeper React migration.*

**Rationale:** This is the most valuable next step because:
1. Makes the codebase navigable — currently everything is in one file
2. Reduces risk for Phase 4+ — smaller focused modules are easier to refactor
3. Identifies what's dead code vs actively used
4. Can be done incrementally without breaking the app

#### Step 3.1: Create `js/modules/lesson-init.js`
Extract: `initializeApp()`, `initializeLesson()`, course/lesson ID resolution, URL param handling, `resolveCurrentLessonId`, `resolveCurrentCourseId`, `getUrlParamCaseInsensitive`

#### Step 3.2: Create `js/modules/answer-pipeline.js`
Extract: `submitAnswerPrecheck()`, `handleAnswer()`, `validateAnswerPrecheck()` (or import from existing), answer validation and submission flow

#### Step 3.3: Create `js/modules/scoring.js`
Extract: Score deduction logic, `deductSpeakingScore`, `deductListeningScore`, `deductFlowScore`, `addHeart`, `removeHeart`, score-related event handlers (`transcriptRejected`, etc.)

#### Step 3.4: Clean up `app.js`
After extraction, `app.js` becomes a thin orchestrator that imports and wires modules together. Remove the "STOPGAP" comments since the functions are now legitimately in their proper modules.

**Relevant files:** `js/app.js`, `js/modules/lessonRouting.js`, `js/modules/scoring.js` (existing)

---

### Phase 4: `ui.js` Cleanup

*`ui.js` (1613 lines) stays as the bridge. Clean up only what's redundant — don't delete it.*

| Step | Description |
|------|-------------|
| 4.1 | Inventory all functions by category (chat bridge, HTML generators, DOM manipulators, utilities) |
| 4.2 | Extract chat bridge functions to `js/modules/chat-bridge.js` (optional, if helpful) |
| 4.3 | Deduplicate `buildGrammarDiff` → `grammar-diff.js` |
| 4.4 | Extract pure utilities (e.g., `escapeHTML`) to `js/modules/utils.js` |
| 4.5 | Remove only truly dead code — function must be unreachable from ALL code paths |

---

### Phase 5: Wire Video Wrappers to Zustand

*Video wrapper components exist but are inert. Wire them to Zustand state so React controls video lifecycle.*

| Step | Description |
|------|-------------|
| 5.1 | Add `videoUrl`, `videoConfig`, `currentVideoType` to Zustand store |
| 5.2 | Wire `InteractiveVideoWrapper` to read from Zustand and mount/destroy accordingly |
| 5.3 | Wire `SimpleVideoWrapper`, `IntroVideoWrapper`, `VideoProcessorWrapper` |
| 5.4 | Replace vanilla `loadVideoForStep()` writes to Zustand instead of directly creating DOM |

---

### Phase 6: HTML Pages → React Routes

*Convert standalone HTML pages to React components. Lower risk, self-contained.*

| Step | Description |
|------|-------------|
| 6.1 | Convert Vite multi-page build to SPA (single `index.html` entry) |
| 6.2 | Migrate `homescreen.html` → `HomeScreen.jsx` |
| 6.3 | Migrate auth pages (`login.html`, `signup.html`, `userprofile.html`, etc.) |
| 6.4 | **SKIP** — `landing.html` stays as standalone marketing page |
| 6.5 | Delete old HTML files, update Vite config |
| 6.6 | Remove STOPGAP duplicates from `app.js` (functions now handled by React Router) |

---

### Phase 7: Architecture Modernization

| Step | Description |
|------|-------------|
| 7.1 | Populate `js/context/` with React Context providers (Auth, Course, Lesson) |
| 7.2 | Eliminate `dangerouslySetInnerHTML` from chat messages |
| 7.3 | Remove `window.isMicActive` property bridge |
| 7.4 | Single entry point (`js/index.jsx` only — remove `app.js` script tag) |
| 7.5 | Re-enable NLP worker |
| 7.6 | CSS consolidation — extract inline `<style>` to `css/style.css` |
| 7.7 | Test coverage audit |

---

## Migration Tracking Checklist

### Phase 1: Foundation
- [ ] 1.4: Audit unused/dead code (DEFERRED)

### Phase 2: Lesson Body Reactification ✅
- [x] 2.1: LessonContainer renders a shell
- [x] 2.2: Verify existing React components work in the shell
- [x] 2.3: Add video player wrappers to the shell
- [x] 2.4: Keep step-loader as vanilla
- [x] 2.5: Test the hybrid flow
- [x] 2.6: 🚫 CANCELLED — STOPGAPs still in active use

### Phase 3: `app.js` Refactor
- [ ] 3.1: Extract lesson initialization → `lesson-init.js`
- [ ] 3.2: Extract answer pipeline → `answer-pipeline.js`
- [ ] 3.3: Extract scoring logic → `scoring.js`
- [ ] 3.4: Clean up `app.js` orchestrator

### Phase 4: `ui.js` Cleanup
- [ ] 4.1: Inventory functions by category
- [ ] 4.2: Extract chat bridge → `chat-bridge.js`
- [ ] 4.3: Deduplicate `buildGrammarDiff`
- [ ] 4.4: Extract pure utilities
- [ ] 4.5: Remove only truly dead code

### Phase 5: Wire Video to Zustand
- [ ] 5.1: Add video state to store
- [ ] 5.2: Wire InteractiveVideoWrapper
- [ ] 5.3: Wire SimpleVideoWrapper, IntroVideoWrapper, VideoProcessorWrapper
- [ ] 5.4: Route video loading through Zustand

### Phase 6: HTML Pages → React Routes
- [ ] 6.1: Convert to SPA
- [ ] 6.2: `HomeScreen.jsx`
- [ ] 6.3: Auth pages as React components
- [ ] 6.4: SKIP — `landing.html` stays standalone
- [ ] 6.5: Delete old HTML files
- [ ] 6.6: Remove STOPGAPs from `app.js`

### Phase 7: Architecture Modernization
- [ ] 7.1: React Context providers
- [ ] 7.2: Eliminate `dangerouslySetInnerHTML`
- [ ] 7.3: Remove `window.isMicActive` bridge
- [ ] 7.4: Single entry point
- [ ] 7.5: Re-enable NLP worker
- [ ] 7.6: CSS consolidation
- [ ] 7.7: Test coverage audit

---

## Risk Considerations

- **High:** Phase 3 (app.js refactor) — the answer pipeline is the most critical code path. Extract with care, test after each extraction.
- **Medium:** Phase 5 (video to Zustand) — video players have subtle timing/event logic. The wrappers already exist; focus on correct lifecycle.
- **Low:** Phase 6 (HTML pages) — self-contained pages, easy to verify visually.
- **Low:** Phase 7 (cleanup) — purely cosmetic or straightforward.

## Completion Criteria

1. `index.html` is the SPA entry point; `landing.html` stays standalone
2. All UI layout and data-display handled by React components
3. `js/app.js` is purely a module of exported utility functions (no `DOMContentLoaded` auto-init)
4. `js/components/ui.js` remains as the essential bridge (NOT deleted)
5. Video players remain as vanilla JS classes wrapped in React components
6. All CSS in `.css` files
7. Zustand store is the single source of truth — no `window` property bridges
8. All `dangerouslySetInnerHTML` eliminated (except trusted static content)
9. All routes work via React Router in a single-page application
10. **The app is fully functional at each step** — no regressions between phases
