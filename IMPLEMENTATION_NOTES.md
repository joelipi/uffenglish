# Implementation Notes

## Open Questions Resolved with Assumptions
*   **Previous Streak Storage:** The problem requires acknowledging if the user's streak has increased since the last session. Because Zustand's `persist` runs on every update and over-writes the streak before the app might have fully booted to display a comparison, I made the assumption to store the `previousStreak` in `sessionStorage` whenever an acknowledgment is shown so that it doesn't repeatedly show up in the same session while still firing when the streak exceeds `1`.
*   **Missing Imports in `ui.js`:** The prompt required modifying `initTutorChatUI` to intercept `@grammar` directly and wire `routeInput`. I placed these logic handlers directly inside `initTutorChatUI` alongside existing logic but assumed the `askWorker` function is globally available (`window.askWorker`) as requested by the prompt ("implement with askWorker injected (not imported)").
*   **React Native / XState 5 Adapter:** The `conversationService.start()` function was implemented to explicitly initialize context via `input:` since XState v5 doesn't hydrate contexts during `.start()` after creation the same way older versions did.

## Existing Patterns Followed Not Specified
*   The `update_course_manifests.py` explicitly iterates over all `js/config/*.json` files to update them with missing recommendation pipeline fields (`tags`, `focus`, and `recommendedNextCourseId`) matching the exact structure from the existing `gt2.json` files and others.

## TanStack Query
*   **Status:** Present.
*   **Action Taken:** Used Zustand for `user` metrics (added missing fields) and TanStack Query is imported in `api.js` for profile operations. For the recommender engine itself, the `manifest` is read directly from the locally fetched config data (`State.configData.lessons` mapped into courses or the whole manifest config array).

## `franc` Language Detection
*   **Status:** Not present in `package.json`.
*   **Action Taken:** Implemented a lightweight fallback heuristic in `inputRouter.js` (`outOfScopeClassifier`) using string lengths, punctuation checks, and a topic keyword blocklist (`['weather', 'prices', 'sports', 'recipe', 'politics', 'religion']`) to identify out-of-scope intent rather than introducing a new dependency for language detection.

## Where `lastCompletedCourseId` is written
*   **File:** `js/app.js`
*   **Function Name:** `showCompletionMessage()`
*   **Details:** The `appStore.getState().setLastCompletedCourseId(State.courseId)` function is called right before the completion message is shown to the user to mark the course completed.

## Where `initRecommendationUI` is called from
*   **File:** `js/app.js`
*   **Function Name:** `initializeApp()`
*   **Details:** It's called immediately after `conversationService.start(initialContext)` starts the XState actor in the early stages of initialization.

## Course Config Files Modified
*   All course config files ending in `.json` inside `js/config/` directory were updated using a script to inject the following fields to their root object:
    *   `tags: ["food", "dining", "service_encounters", "daily_life"]`
    *   `focus: ["speaking", "vocabulary", "pronunciation"]`
    *   `recommendedNextCourseId: null`

## Streak Increase Detection
*   **Mechanism:** Checked inside the XState `idle` state subscription inside `initRecommendationUI` in `js/components/ui.js`.
*   **Assumption Made:** It reads the `previousStreak` from `sessionStorage` (defaulting to 0) and compares it with `context.user.streak`. If the context streak is higher and greater than or equal to `STREAK_CELEBRATION_THRESHOLD` (1), it fires a chat bubble. It then updates `sessionStorage` with the new streak to prevent repeated acknowledgments.

## Avatar Stubs Needs
*   The `@support` and `@vocabulary` channels use the default `teacherprofile.webp` avatar ("Joe Walsh").
*   The `@aitutor` and `@grammar` channels use the `ai.webp` avatar ("AI Tutor" and "Grammar Check").
*   If unique avatars for support or vocabulary are desired later, they will need dedicated image assets.

## Notes for Next Developer
*   The `conversationMachine` uses `setup()` and `createMachine()` syntax compatible with XState v5. Be sure any Native adapters account for XState v5's API surface (`input`, etc.) instead of v4.
*   The `filterPipeline` is entirely side-effect free and decoupled from any UI framework, per the architectural constraint.
*   In `ui.js`, the `handleGrammarChannel` awaits `window.askWorker`. Once the NLP worker (`nlp-worker-web.js`) is re-enabled, ensure that the `postMessage` protocol binds a function to `window.askWorker(action, payload)` returning a Promise that resolves when the worker replies.

## Course Manifest Note
*   **Status:** Partially stubbed.
*   **Action Taken:** `conversationMachine` expects a `manifest` array. In `app.js`, `State.configData` is wrapped into a 1-item array. In a real environment, this should be fetched from a TanStack Query cache representing all available courses.