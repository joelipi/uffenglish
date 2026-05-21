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
- `js/components/LessonContainer.jsx` — route component, **now renders a React shell** managing all lesson portals

### What's Still Vanilla JS
- `js/app.js` (~1017 lines) — main application controller, lesson orchestration, answer handling
- `js/components/ui.js` (1613 lines, 66KB) — UI bridge monolith, DOM manipulation, Zustand writes
- `js/components/step-loader.web.js` (446 lines) — step loading orchestration
- `js/components/interactive-video-player.js` (359 lines) — vanilla IVP class
- `js/components/simple-video-player.js` (401 lines) — vanilla SVP class
- `js/components/intro-background-video.js` (97 lines) — vanilla intro video class
- `js/components/feedback-renderer.web.js` — feedback HTML generation
- `js/components/point-loss-animation.js` — floating animation
- `js/components/mic-animation.js` — mic initialization
- `js/components/success-lesson.js` — lesson completion
- All standalone HTML pages: `homescreen.html`, `login.html`, `signup.html`, `userprofile.html`, `recover-password.html`, `reset-password.html` (`landing.html` stays as standalone marketing page — see Phase 5.4)

### Key Architecture Facts
- **State bridge:** Zustand vanilla store (`js/modules/store.js`) with persist middleware — serves as shared state between vanilla JS and React
- **Routing:** `react-router-dom` v7.15.1 active; route changes are signaled via `hybridRouteChange` custom events from React to vanilla JS. URL format: `/course/:courseId/lesson/:lessonId`
- **URL resolution:** `initializeApp()` and `initializeLesson()` in `app.js` now read `courseId`/`lessonId` from the URL pathname first (`/course/:courseId/lesson/:lessonId` regex match), falling back to query params, then Zustand/localStorage
- **URL param wiping:** Stale `?courseid`/`?lessonid` query params are stripped via `history.replaceState` after they're consumed (gated on `routerContext.urlLessonId && window.location.search`)
- **CSS:** All styles are inline `<style>` blocks in each HTML file. No `style.css` exists. Bootstrap 5.3.3 loaded from CDN.
- **Entry point:** Both `js/app.js` and `js/index.jsx` load as separate `<script type="module">` tags in `index.html`
- **Platform targets:** Platform adapter pattern (`.web.js` / `.native.js`) exists for future React Native support
- **Build:** Vite 8.0.10, multi-page build with 5 HTML entry points

---

## ASSESSMENT & CORRECTIONS

### Critical Clarification: Keep Vanilla JS in Wrappers

**The original plan incorrectly suggested converting ALL vanilla JS classes to pure React components. This is wrong.** The app's current architecture — vanilla JS classes mounted inside React wrappers — is the **correct pattern** for complex DOM manipulation and should be preserved.

**Correct Pattern (already in use):**
```
React Wrapper Component (JSX + Refs)
  └── Vanilla JS Class (programmatic DOM creation)
```

**Examples that should NOT be converted to pure React:**
- `InteractiveVideoPlayerUI` (creates ~20+ DOM elements programmatically, complex state transitions)
- `simpleVideoPlayer` (creates custom video controls, overlays)
- `introBackgroundVideo` (creates pulsing ring animations, notification UI)
- `point-loss-animation.js` (creates floating point elements)
- `mic-animation.js` (creates mic initialization animations)

**What SHOULD be React-ified:**
- Anything that displays data from Zustand (chat messages, scores, stats)
- Layout containers and page structure
- Form inputs and buttons
- Modal overlays and dialogs
- Simple animations that can use CSS classes or React state

**The `ui.js` file serves as the bridge**: It writes to Zustand, and React automatically re-renders. This pattern is correct and should continue — `ui.js` doesn't need to be deleted, just cleaned up where redundant.

### Functional Checkpoint Strategy

**The app must remain functional at the end of EACH step.** Therefore, phases must be restructured to:
1. Build the React layer FIRST while keeping vanilla working
2. Switch to React layer as a unit
3. Verify the full lesson flow works
4. Only THEN remove/replace the old code

---

## Bugs Fixed During Active Development

These were discovered and fixed during the migration process, not as part of a specific phase:

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| AI tutor chat not rendering | `renderTutorMessage()` wrote HTML directly instead of pushing to Zustand | Changed to `addChatMessage()` — React renders from Zustand |
| `AiLoadingBubble` showing HTML tags as text | JSX `{defaultText}` auto-escapes, but `Strings.get()` returns HTML with `<br>`/`<span>` | Switched to `dangerouslySetInnerHTML` |
| Stale "FluIntel AI" loading bubble after openResponse answer | `renderAIAnalysisLoading()` called at `app.js:565` with no matching `removeAILoadingStatus()` | Removed the call |
| Double-escaped HTML entities in user responses (`&#39;` displayed literally) | `escapeHTML()` in `renderUserChatMessage` + React's `{text}` auto-escape = double escape | Removed `escapeHTML()` — React handles it |
| Chat message list not scrollable | `#react-root-chat` React wrapper broke the flex chain inside `#chat-window-container` | Added `flex: 1; min-height: 0; display: flex; flex-direction: column` to `#react-root-chat` |
| App not clickable with DevTools console open + video not pausing | `will-change: opacity, transform` on `.ivp-main-wrapper` created a Chrome compositing layer that intercepted all input when DevTools opened | Removed `will-change` from `.ivp-main-wrapper`; set `#chat-window-container` z-index from 1051→11 (above play overlay's 10, not blocking video) |

---

## Phased Migration Roadmap (Revised)

---

### Phase 1: Foundation Cleanup

*Low-risk cleanup that enables the React migration.*

#### Step 1.1: Skip - CSS handled later

**CSS extraction will be addressed later in the migration, after the React components are built. Moving CSS before having React components to style provides little value.**

#### Step 1.2: Skip - Other HTML pages will be reworked in Phase 5

**The other HTML pages (`homescreen.html`, `login.html`, `signup.html`, `userprofile.html`, etc.) will be completely reworked as React routes in Phase 5. Skip extracting their CSS now — it will be handled when those pages are migrated to React.**

#### Step 1.3: Deferred — resolved AFTER Phase 2 (see Phase 2.4)

**STOPGAP duplicates in `js/app.js` (lines 146–208) will be removed after the hybrid flow is verified working in Phase 2.4.**

#### Step 1.4: Audit and clean up unused code

**Current state:** Not yet done.

**Actions:**
1. `js/modules/useLessonRouter.js` — verify it is truly unused (search all `.jsx` and `.js` files for imports). Either integrate it (see Phase 2) or delete it with a note.
2. `js/context/` directory — empty. Decide whether to populate in Phase 6 or remove.
3. `js/components/interactive-video-player.native.jsx`, `js/components/simple-video-player.native.jsx`, `js/modules/video-processor-native.jsx` — confirm these are intentional stubs for future React Native work, not dead code.
4. Run a global search for any other `TODO`, `FIXME`, `STOPGAP`, or `TEMP` comments and catalog them for tracking.

**Expected outcome:** Clear inventory of all deferred work items and dead code.

---

### Phase 2: Lesson Body Reactification (Realistic Scope)

*The core migration, scoped realistically. Keep the heavy DOM manipulation in vanilla JS, add React shell and wrapper components.*

**What stays vanilla (NOT converted to React):**
- `step-loader.web.js` — Creates step content DOM programmatically based on step type
- `ui.js` — Heavy DOM manipulation functions (renderTextInputUI, renderSpeechInputUI, etc.)
- Video player classes — Complex programmatic DOM creation

**What becomes React:**
- Lesson layout shell (replacing empty `<></>`) — ✅ DONE
- Better integration of existing React components — ✅ DONE (portals moved into LessonContainer)
- React wrapper components that mount vanilla classes — NEXT

#### Step 2.1: ✅ LessonContainer renders a shell **(DONE)**

**What was done:**
1. Created `js/components/lesson/Header.jsx` — portals `ActivityStats` into `#react-root-activity`
2. Created `js/components/lesson/ChatContainer.jsx` — portals `ChatInterface` into `#react-root-chat`
3. Created `js/components/lesson/StatsBar.jsx` — portals `ScoreBoard` into `#react-root-stats`
4. Rewrote `LessonContainer.jsx` to render `<div className="react-lesson-shell">` wrapping Header, StatsBar, ChatContainer, MicrophoneToggle, and modals. Keeps `hybridRouteChange` event.
5. Simplified `App.jsx` — removed all portal rendering. App is now just BrowserRouter + Routes + LessonContainer + AI worker boot.
6. Fixed `initializeApp()` and `initializeLesson()` to read `courseId`/`lessonId` from URL pathname (`/course/:courseId/lesson/:lessonId`), falling back to query params, then memory.
7. Fixed URL param wiping to work with path-based URLs (stale `?courseid`/`?lessonid` stripped after consumption).

**URL format:** Changed from `index.html?courseid=gt2` (query params) to `/course/:courseId/lesson/:lessonId` (React Router path).

**Key files:**
- `js/components/LessonContainer.jsx` — shell component
- `js/components/lesson/Header.jsx` — header shell
- `js/components/lesson/ChatContainer.jsx` — chat shell
- `js/components/lesson/StatsBar.jsx` — stats shell
- `js/App.jsx` — simplified, no portals
- `js/app.js` lines 757–759 (path-based lessonId), lines 902–907 (path-based courseId), lines 775–791 (param wiping)

#### Step 2.2: Verify existing React components work in the shell

**Current state:** NOT YET VERIFIED.

**Actions:**
1. Ensure all existing React components are properly mounted within the LessonContainer shell
2. Verify chat, stats, and mic toggle still work with the new shell
3. Test the full lesson flow at `/course/model/lesson/a`: load → prompt → answer → feedback → continue

**Expected outcome:** Existing React components continue working within the shell.

#### Step 2.3: Add video player wrappers to the shell

**Current state:** Video wrappers exist but may not be in the React tree.

**Actions:**
1. Add the existing video wrapper components to the LessonContainer shell
2. Ensure they're mounted/unmounted properly
3. Video players stay as vanilla classes inside React wrappers (correct pattern)

**Expected outcome:** Video players work within the React shell.

#### Step 2.4: Don't replace step-loader - just wrap it

**Key insight:** `step-loader.web.js` creates DOM programmatically for different step types. This should NOT be converted to pure JSX. The correct approach is:
- Keep `step-loader.web.js` as-is (vanilla JS module)
- Keep `ui.js` DOM manipulation as-is
- React wraps the container, vanilla fills it

**Actions:**
1. Accept that step-loader won't be React-ified
2. Focus on making the React shell work around it
3. The vanilla code writes to Zustand, React reads and re-renders chat/stats

**Expected outcome:** Realistic scope - heavy DOM code stays vanilla, React provides the shell.

#### Step 2.5: Test the hybrid flow

**Actions:**
1. Run the app at `/course/:courseId/lesson/:lessonId`
2. Test: load lesson → see prompt → answer → feedback → continue → next step
3. Verify React components (chat, stats, mic) still work
4. Verify vanilla step-loader still works (loads step content)
5. Monitor console for errors/warnings

**Expected outcome:** The hybrid works - React shell + vanilla step content + Zustand bridge.

#### Step 2.6: Remove STOPGAP duplicates from `js/app.js`

**After Step 2.5 is verified working:**
- React now uses `lessonRouting.js` directly
- Vanilla can use the imported functions instead of STOPGAP duplicates
- Remove the STOPGAP block (lines 146–208 in app.js)
- Verify lesson still works

---

### Phase 3: `ui.js` Cleanup (NOT Decomposition)

*Do NOT delete `ui.js`. It is the essential bridge between vanilla JS and React. Clean up only what's redundant.*

#### Step 3.1: Inventory all functions in `ui.js`

**Current state:** 1613 lines, 66KB. Mix of Zustand writes, HTML string generation, DOM manipulation, and utility functions.

**Actions:**
1. Catalog every exported and internal function in `ui.js` into categories:
   - **Chat bridge functions:** Functions that push to `chatHistory` in Zustand (e.g., `renderUserChatMessage`, `renderAIFeedback`, `renderAIAnalysisLoading`) — **KEEP, this is the bridge**
   - **HTML generators:** Functions returning HTML strings (e.g., `buildGrammarDiff`, feedback HTML) — **KEEP for backward compatibility**
   - **DOM manipulators:** Functions using `innerHTML`, `createElement`, `appendChild` (e.g., `generateHangmanHint`, mic status, mission text) — **EVALUATE: some may be replaced by React, but the function can stay for vanilla-only paths**
   - **Pure utilities:** Functions with no side effects (e.g., `escapeHTML`) — **MOVE to utils.js if not already there**
   - **Animation triggers:** Functions that start/stop animations — **KEEP, used by vanilla video players**

2. The key insight: `ui.js` should STAY as the bridge. It writes to Zustand, React re-renders. Only clean up truly dead code or move pure utilities.

#### Step 3.2: Extract chat bridge functions

**Actions:**
1. Create `js/modules/chat-bridge.js`
2. Move Zustand chat-writing functions into this file:
   - `renderUserChatMessage()` → `addUserMessage(text)`
   - `renderAIFeedback()` → `addAIFeedbackMessage(feedback)`
   - `renderAIAnalysisLoading()` → `addLoadingMessage()`
   - Any other functions that call `appStore.getState().addChatMessage()`
3. Update all importers in vanilla JS to use `chat-bridge.js`
4. These functions are already Zustand-mediated, so React chat bubbles will pick up changes automatically

#### Step 3.3: Deduplicate `buildGrammarDiff`

**Current state:** Both `ui.js` and `GrammarDiffBubble.jsx` contain grammar diff logic.

**Actions:**
1. Create `js/modules/grammar-diff.js` with the canonical `buildGrammarDiff()` function
2. Import it in both `ui.js` (for backward compatibility) and `GrammarDiffBubble.jsx`
3. Remove the duplicated implementations

#### Step 3.4: Extract pure utilities

**Actions:**
1. Move `escapeHTML()` and any other pure utility functions to `js/modules/utils.js` (if not already there)
2. Update all imports

#### Step 3.5: Remove only truly dead code

**As Phase 2 components are completed, evaluate whether to remove corresponding functions from `ui.js`:**
- `generateHangmanHint()` → could stay for any vanilla-only paths, mark as "may be deprecated"
- Mic status `innerHTML` → could stay for vanilla-only paths
- Mission text `innerHTML` → could stay for vanilla-only paths
- `handlecueUI()` / `handleIncueUI()` → could stay for vanilla-only paths
- `showPlaybackVideo()` → should stay (still used by video player logic)
- `clearChatInterface()` → could stay

**The key principle:** Don't delete functions just because there's now a React alternative. Keep them for backward compatibility during the transition. Only remove code that is truly no longer called by ANY path.

#### Step 3.6: Keep `ui.js` as the bridge

**`js/components/ui.js` remains as the essential bridge between vanilla JS and React.** It writes to Zustand, React consumes Zustand state. This is the correct pattern.

**Expected outcome:** `ui.js` is cleaned up (moved pure utilities, removed truly dead code), but remains as the communication layer between vanilla modules and React components.

---

### Phase 4: Video Player Wrapper Improvements

*The existing wrapper pattern is correct. Focus on improving the React wrappers, not converting to pure React.*

#### Step 4.1: Improve `IntroVideoWrapper.jsx`

**Current state:** Already exists, wraps vanilla `introBackgroundVideo` class. Works correctly.

**Actions:**
1. Keep `intro-background-video.js` vanilla class as-is
2. Improve the React wrapper component:
   - Add proper TypeScript-like prop types documentation (even if not using TS)
   - Add error boundaries around the wrapper
   - Ensure cleanup properly destroys the vanilla instance
3. The hardcoded `#intro-call-widget` div in `index.html` can stay — it's the mount point the wrapper uses
4. **DO NOT delete the vanilla class** — this is the correct pattern

#### Step 4.2: Improve `SimpleVideoWrapper.jsx`

**Current state:** Already exists, wraps vanilla `simpleVideoPlayer` class.

**Actions:**
1. Keep `simple-video-player.js` vanilla class as-is
2. Improve the React wrapper:
   - Add prop validation and defaults
   - Add error boundaries
   - Ensure proper cleanup on unmount
3. Keep the hardcoded `#simple-video-container` mount point
4. **DO NOT convert to pure React** — the complex DOM manipulation should stay as vanilla

#### Step 4.3: Improve `InteractiveVideoWrapper.jsx`

**Current state:** Already exists, wraps vanilla `InteractiveVideoPlayerUI` class. Most complex video player.

**Actions:**
1. Keep `interactive-video-player.js` vanilla class as-is
2. The vanilla class creates ~20+ DOM elements programmatically, manages complex state transitions, animation timers — this SHOULD stay as vanilla
3. Improve the React wrapper with:
   - Better state synchronization between React and vanilla
   - Error boundaries
   - Proper lifecycle management
4. Keep the hardcoded `#ivp-container` mount point

#### Step 4.4: Improve `VideoProcessorWrapper.jsx`

**Current state:** Already exists, wraps `initVideoProcessor` / `cleanupVideoProcessor` from `video-processor.web.js`.

**Actions:**
1. If `video-processor.web.js` is framework-agnostic processing logic (no DOM), keep as-is
2. Rename wrapper from `VideoProcessorWrapper.jsx` → `VideoProcessor.jsx` (remove "Wrapper" suffix)
3. Keep the wrapper pattern — it's correct

#### Step 4.5: No `index.html` changes needed

**The hardcoded video container divs in `index.html` serve as mount points for the wrappers. They should stay.** They are:
- `#ivp-container` — mount point for `InteractiveVideoWrapper`
- `#simple-video-container` — mount point for `SimpleVideoWrapper`
- `#intro-call-widget` — mount point for `IntroVideoWrapper`

**Expected outcome:** Video player wrappers are improved but the vanilla classes remain. This is the correct hybrid architecture.

---

### Phase 5: Remaining HTML Pages → React Routes

*Lower risk, can be done incrementally. Each page is self-contained.*

#### Step 5.1: Convert Vite multi-page build to SPA

**Current state:** `vite.config.js` defines 5 entry points (`index.html`, `homescreen.html`, `login.html`, `signup.html`, `userprofile.html`). This means each page is a separate HTML document — not a true SPA.

**Actions:**
1. Add new routes to `App.jsx`:
   ```jsx
   <Route path="/" element={<HomeScreen />} />
   <Route path="/login" element={<Login />} />
   <Route path="/signup" element={<Signup />} />
   <Route path="/profile" element={<UserProfile />} />
   <Route path="/recover-password" element={<RecoverPassword />} />
   <Route path="/reset-password" element={<ResetPassword />} />
   <!-- Landing page stays as standalone HTML — not migrated to React -->
   ```
2. After all pages are migrated, remove the extra entries from `vite.config.js` `rollupOptions.input`, keeping only `index.html`
3. Add a Vite dev server fallback rewrite so all routes serve `index.html` (for client-side routing):
   ```js
   // In vite.config.js, consider using a plugin or configureServer for SPA fallback
   ```

#### Step 5.2: Migrate `homescreen.html` → `HomeScreen.jsx`

**Actions:**
1. Create `js/components/pages/HomeScreen.jsx`
2. Port the vanilla JS logic from `homescreen.html`'s inline `<script>` blocks
3. Rebuild the course selection/browsing UI as React components
4. Extract its inline CSS into `css/style.css` (or a minimal `css/homescreen.css` if truly page-specific)
5. Link navigation from lesson completion, profile, etc. to use React Router `<Link>` or `useNavigate()`

#### Step 5.3: Migrate auth pages → React components

**Current state:** `login.html`, `signup.html`, `userprofile.html`, `recover-password.html`, `reset-password.html` each have their own HTML + inline CSS + inline JS.

**Actions:**
1. Create `js/components/auth/Login.jsx`, `Signup.jsx`, `UserProfile.jsx`, `RecoverPassword.jsx`, `ResetPassword.jsx`
2. Port form logic, validation, and Appwrite API calls from the vanilla JS into React hooks
3. Use the existing Zustand store or React Context for auth state
4. Extract inline CSS to `css/style.css` (most auth styling should be shared)
5. Add client-side redirects for authenticated/unauthenticated states

#### Step 5.4: Skip — `landing.html` stays as standalone

**`landing.html` is a marketing/landing page that is intentionally separate from the app SPA. It will not be migrated to React.** It functions as its own standalone entry point and will remain as-is.

#### Step 5.5: Remove old HTML files (excluding `landing.html`)

**Actions:**
1. Once each page is verified working as a React route, delete the corresponding `.html` file
2. Update `vite.config.js` to remove the entry
3. Verify all cross-page navigation links work (no broken `<a href="...">` pointing to deleted `.html` files)

**Expected outcome:** Single `index.html` entry point for the SPA. All app pages are React routes. `landing.html` remains as a standalone marketing page with its own entry point.

---

### Phase 6: Architecture Modernization

*Cleanup and hardening after the core migration is stable.*

#### Step 6.1: Populate `js/context/` with React Context providers

**Current state:** `js/context/` directory is empty.

**Actions:**
1. Create `js/context/AuthContext.jsx` — provides auth state (user, session, login/logout/signup functions)
2. Create `js/context/CourseContext.jsx` — provides current course data, lesson list
3. Create `js/context/LessonContext.jsx` — provides current lesson state, step data, answer state
4. Wrap the app in these providers in `App.jsx`
5. Reduce prop drilling and direct Zustand imports in deep components (use context as a convenience layer over Zustand)

#### Step 6.2: Eliminate `dangerouslySetInnerHTML` from chat messages

**Current state:** Some chat messages are stored as raw HTML strings (`type: 'htmlChunk'`) in Zustand's `chatHistory`, rendered via `dangerouslySetInnerHTML`.

**Actions:**
1. Audit all `addChatMessage()` calls that push HTML strings
2. For each, determine the structured data that the HTML represents and add a new chat message type (e.g., `type: 'structuredFeedback'` with `{ data: {...} }`)
3. Create corresponding React bubble components that render the structured data
4. Migrate callers one by one
5. Remove `htmlChunk` handling from `ChatInterface.jsx`
6. Remove all `dangerouslySetInnerHTML` usage (except possibly for truly trusted static content)

#### Step 6.3: Remove the `window.isMicActive` property bridge

**Current state:** `js/modules/store.js` (line ~274) uses `Object.defineProperty` on `window` to bridge `isMicActive` between vanilla JS and React.

**Actions:**
1. Identify all vanilla JS code that sets `window.isMicActive` — change to `appStore.getState().setMicActive(true/false)`
2. Identify all code that reads `window.isMicActive` — change to `appStore.getState().isMicActive`
3. Remove the `Object.defineProperty` bridge from `store.js`
4. The `MicrophoneToggle.jsx` React component already subscribes to Zustand, so no changes needed there

#### Step 6.4: Single entry point — remove `js/app.js` as a standalone script

**Current state:** Both `js/app.js` and `js/index.jsx` are loaded as `<script>` tags in `index.html`.

**Actions:**
1. After Phase 2 is complete, `js/app.js` should be reduced to a collection of exported functions (no `DOMContentLoaded` auto-init)
2. Import what's needed from `js/app.js` into React components (or better, into dedicated modules like `answer-handler.js`)
3. Remove the `<script type="module" src="js/app.js">` tag from `index.html`
4. `js/index.jsx` becomes the sole entry point

#### Step 6.5: Re-enable NLP worker

**Current state:** `js/workers/nlp-worker-web.js` has the NLP worker temporarily disabled "to save system resources during intense development."

**Actions:**
1. Review the worker's resource usage
2. If resource concerns are still valid, add an environment flag (`VITE_ENABLE_NLP=true`) so it can be toggled without code changes
3. Otherwise, remove the early return and re-enable
4. Test that NLP-dependent features work correctly

#### Step 6.6: TypeScript evaluation

**Current state:** Entire project is plain JavaScript. React components use `.jsx` extension.

**Actions:**
1. Evaluate whether TypeScript adoption is desired. If so:
   - Rename `.jsx` to `.tsx` incrementally
   - Add type definitions for Zustand store, API responses, lesson data structures, and chat message types
   - Configure `tsconfig.json` with strict mode
2. If TypeScript is NOT desired, consider adding JSDoc type annotations for IDE support without a build step
3. This is a separate decision — document the outcome here or in a separate ADR

#### Step 6.7: Test coverage audit

**Actions:**
1. Run existing test suite (`npm test` for Vitest, `npx playwright test` for E2E)
2. Identify coverage gaps created by the migration
3. Add tests for new React components:
   - Unit tests for lesson hooks (Vitest + React Testing Library)
   - Component tests for chat bubbles, feedback, video players
   - E2E tests for the complete lesson flow in React

---

## Migration Tracking Checklist

### Phase 1: Foundation Cleanup
- [ ] 1.1: SKIP — CSS handled in Phase 6
- [ ] 1.2: SKIP — Other HTML pages reworked in Phase 5
- [ ] 1.3: DEFERRED — STOPGAP duplicates removed after Phase 2 (see Phase 2.6)
- [ ] 1.4: Audit and catalog unused/dead code

### Phase 2: Lesson Body Reactification (Realistic Scope)
- [x] 2.1: LessonContainer renders a shell (replaced `<>`)
- [ ] 2.2: Verify existing React components work in the shell
- [ ] 2.3: Add video player wrappers to the shell
- [ ] 2.4: Keep step-loader as vanilla (don't convert to React)
- [ ] 2.5: Test the hybrid flow (React shell + vanilla content)
- [ ] 2.6: Remove STOPGAP duplicates from `js/app.js` (after 2.5 verified)

### Phase 3: `ui.js` Cleanup
- [ ] 3.1: Inventory all functions by category (KEEP chat bridge, HTML generators)
- [ ] 3.2: Extract chat bridge → `chat-bridge.js` (optional, if helpful)
- [ ] 3.3: Deduplicate `buildGrammarDiff` → `grammar-diff.js`
- [ ] 3.4: Extract pure utilities → `utils.js`
- [ ] 3.5: Remove only truly dead code (sync with Phase 2)
- [ ] 3.6: Keep `ui.js` as the bridge (NOT deleted)

### Phase 4: Video Player Wrapper Improvements
- [ ] 4.1: Improve `IntroVideoWrapper.jsx` (keep vanilla class)
- [ ] 4.2: Improve `SimpleVideoWrapper.jsx` (keep vanilla class)
- [ ] 4.3: Improve `InteractiveVideoWrapper.jsx` (keep vanilla class)
- [ ] 4.4: Rename `VideoProcessorWrapper.jsx` → `VideoProcessor.jsx`
- [ ] 4.5: Keep hardcoded video DOM in `index.html` (they are mount points)

### Phase 5: HTML Pages → React Routes
- [ ] 5.1: Convert to SPA (single `index.html` entry, React Router for all routes)
- [ ] 5.2: `homescreen.html` → `HomeScreen.jsx`
- [ ] 5.3: Auth pages → React components
- [ ] 5.4: SKIP — `landing.html` stays as standalone marketing page
- [ ] 5.5: Delete old HTML files, update Vite config

### Phase 6: Architecture Modernization
- [ ] 6.1: Populate React Context providers (`Auth`, `Course`, `Lesson`)
- [ ] 6.2: Eliminate `dangerouslySetInnerHTML` usage
- [ ] 6.3: Remove `window.isMicActive` property bridge
- [ ] 6.4: Single entry point (`js/index.jsx` only)
- [ ] 6.5: Re-enable NLP worker
- [ ] 6.6: TypeScript evaluation (decision point)
- [ ] 6.7: Test coverage audit
- [ ] 6.8: CSS Consolidation — Extract inline `<style>` to `css/style.css` (AFTER React components exist)

---

## Risk Considerations

### High-risk items
- **Phase 2 (lesson body):** The core UX. A regression here breaks the entire app. Test thoroughly after each sub-step at `/course/:courseId/lesson/:lessonId`.
- **Verify after each step:** Load the full lesson flow (start → answer → feedback → continue → next step) before moving on.

### Medium-risk items
- **Video player improvements:** The vanilla classes have subtle timing/event logic. Only improve the React wrappers, don't convert to pure React.
- **Auth page migration:** Appwrite SDK integration must be preserved exactly. Test login, signup, password recovery, and guest mode thoroughly.

### Low-risk items
- **CSS extraction:** Purely cosmetic, easy to verify visually.
- **STOPGAP resolution:** The `lessonRouting.js` functions are already tested — this is just removing duplicates.
- **Landing page, NLP worker re-enable:** Simple conversions or flag toggles.

---

## Completion Criteria

The migration is complete when:
1. `index.html` is the SPA entry point containing only the root `<div>` and script/link tags; `landing.html` remains as a standalone marketing page
2. All UI layout and data-display is handled by React components (chat, stats, forms, layout)
3. `js/app.js` is purely a module of exported utility functions (no `DOMContentLoaded`, no app initialization)
4. `js/components/ui.js` remains as the essential bridge (NOT deleted) — it writes to Zustand, React consumes it
5. Video players remain as vanilla JS classes wrapped in React components (the correct hybrid pattern)
6. All CSS resides in `.css` files, consolidated per AGENTS.md
7. The Zustand store is the single source of truth for all UI state — no `window` property bridges
8. All `dangerouslySetInnerHTML` usage eliminated (except truly trusted static content)
9. All routes work via React Router in a single-page application
10. Tests pass and cover the new React components
11. **The app is fully functional at each step** — no regressions between phases
