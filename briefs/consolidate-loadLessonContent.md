# Consolidate `loadLessonContent` & Eliminate Ref-Based Dep Wiring

## Problem

1. **`loadLessonContent` is duplicated** — near-identical implementations in `useInitializeLesson.js` (lines 76–113) and `app-infra.js` (lines 104–143).
2. **Entire answer pipeline dep wiring is duplicated** — `app-infra.js` creates a self-contained set of deps (submitAnswerPrecheck, showFeedbackAndProceed, handleHint, callLoadStep, loadNextStep, loadLessonContent), then `LessonContainer.jsx` + `useAnswerPipeline.jsx` + `useStepLoader.jsx` recreate identical functions and inject them into `useInitializeLesson` via `useRef`.
3. **Downstream:** `useInitializeLesson`'s `stepLoaderDepsRef` + `setStepLoaderDeps` exist solely to receive these duplicates.

## Solution

`app-infra.js`'s dep set is complete and self-consistent. The duplicate wiring is unused dead weight.

### Step 1 — Create `js/modules/lesson-loader.js`

Shared `loadLessonContent(lesson)` that:
- Combines both versions' reset/cleanup calls
- Reads deps from `appStore.getState().loadLessonContentCallback`
- Sets `currentStepIndex` with resume logic (bounds-checked, defaults to 0)

### Step 2 — Edit `app-infra.js`

Replace inline `loadLessonContent` with a call to the shared version. Registration in store stays. The `handleHint` wrapper stays local (it's passed through `loadStep`'s deps and set per-step by `_renderResponseStep`).

### Step 3 — Edit `useInitializeLesson.js`

- Replace inline `loadLessonContent` with call to shared version (reads from store, no ref needed)
- Remove `stepLoaderDepsRef`, `setStepLoaderDeps`
- `initializeLesson` signature stays the same but internal dep ref is gone

### Step 4 — Edit `LessonContainer.jsx`

- Remove `useAnswerPipeline()`, `useStepLoader()`
- Remove `callLoadStep` callback, `loadNextStep` callback
- Remove `setStepLoaderDeps` effect
- Remove `setCallLoadStep`/`setLoadNextStep` effects
- `onLoadNextLesson` reads `loadLessonContentCallback` directly from store
- `initializeLesson(courseId, lessonId, configData, userData)` call stays

### Step 5 — Delete `js/hooks/useAnswerPipeline.jsx`

Entire file is dead after Step 4.

## Files Changed

| Action | File |
|---|---|
| Create | `js/modules/lesson-loader.js` |
| Edit | `js/hooks/app-infra.js` |
| Edit | `js/hooks/useInitializeLesson.js` |
| Edit | `js/components/LessonContainer.jsx` |
| Delete | `js/hooks/useAnswerPipeline.jsx` |

## Verified Safe

- `app-infra.js` runs during bootstrap (before any route renders) and registers `loadLessonContentCallback` in the store
- By the time `LessonContainer` renders and calls `initializeLesson`, the callback is guaranteed present
- `loadStep` (`step-loader.web.js` → `step-loader-execute.js`) creates a fresh execution wrapper per call, so no stale closure issues
- The `handleHint` callback flows through the same `loadStep` deps and is set per-step by `_renderResponseStep` — no change needed
