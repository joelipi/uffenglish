# Plan: Fix Platform Routing Bugs + Reorganize modules/

## Goal
Prepare the codebase for React Native by fixing 3 broken platform routing files and reorganizing the flat `js/modules/` directory (72 files) into domain-based subdirectories. This makes platform status visible at a glance and sets up clean separation for native implementations.

---

## Phase 1: Fix Platform Routing Bugs (3 files)

These are critical bugs that would cause crashes or wrong code loading on React Native.

### Bug 1: `js/modules/video-processor.js`
- **Current:** `export * from './video-processor.web.js';` — hardcodes web variant, bypassing platform resolution
- **Fix:** Change to `export * from './video-processor';` so Vite resolves `.web.js` on web, and Metro resolves `.native.jsx` on native
- **Note:** The native file is currently named `video-processor-native.jsx` (non-standard). Rename to `video-processor.native.jsx` to match the convention

### Bug 2: `js/modules/storage.js`
- **Current:** `export * from './storage';` — self-referencing, creates circular import on Metro (no `.native.js` exists)
- **Fix (definitive):** Create `storage.native.js` and `storage-adapter.native.js` as stubs. The `storage.native.js` file re-exports from `storage-adapter.native.js`, matching the web pattern where `storage.web.js` uses IndexedDB and `storage-adapter.js` uses localStorage.
- **`storage-adapter.native.js` contents:** Stub that exports `localStore` with `getItem`/`setItem` using a no-op or in-memory fallback (AsyncStorage integration comes later when the actual React Native app is set up)
- **`storage.native.js` contents:** Re-export the same interface as `storage.web.js` (`openMediaDB`, `getAllSpeechRecordingsForLesson`, `saveSpeechRecording`, `updateSpeechRecording`, `deleteSpeechRecording`) — all as stubs that log warnings or return empty results

### Bug 3: `js/modules/speech.js`
- **Current:** Web-only entry point that directly imports `speech.web.js` and web whisper workers. No native counterpart
- **Fix (definitive):** Keep `speech.js` as the web entry. Create `speech.native.js` as a **stub only** — no implementation, just matching exports so Metro doesn't crash at import time.
- **`speech.native.js` contents:** Export `listeningState`, `initLocalVoiceAI`, `toggleSpeechRecognition` as stubs (`listeningState` as a Zustand store slice, the functions as no-ops that log "Not implemented on native"). This ensures the import graph resolves without errors. Actual native speech implementation comes later.

---

## Phase 2: Reorganize modules/ into Subdirectories

### Target Directory Structure

```
js/modules/
├── store/                    # Zustand state management
│   ├── store.js
│   └── store.test.js
│
├── api/                      # TanStack Query + Appwrite backend
│   ├── api.js
│   ├── appwrite.js
│   └── appwrite.test.js
│
├── speech/                   # Speech recognition (web + native needed)
│   ├── speech.js             # Web entry/router
│   ├── speech.web.js
│   ├── speech.core.js
│   ├── speech-orchestrator.js
│   └── speech.native.js      # Stub — to create
│
├── video/                    # Video processing, loading, sharing
│   ├── video-processor.js         # Router (FIXED)
│   ├── video-processor.web.js
│   ├── video-processor.native.jsx # Renamed from video-processor-native.jsx
│   ├── video-processor-logic.js
│   ├── video-loader.js            # Router
│   ├── video-loader.web.js
│   ├── video-share.js             # Router
│   ├── video-share.web.js
│   ├── interactive-video-controller.js
│   └── simple-video-controller.js
│
├── lesson/                   # Lesson loading, progression, step execution
│   ├── lesson-loader.js
│   ├── lesson-progression.js
│   ├── lesson-routing.js          # Renamed from lessonRouting.js
│   ├── step-executor-webonly.js
│   ├── step-loader-callbacks.js
│   ├── step-loader-logic.js
│   ├── step-loader-orchestrate.js
│   └── success-lesson-logic.js
│
├── answer/                   # Answer pipeline, scoring, feedback
│   ├── answer-pipeline.js
│   ├── answer-pipeline.test.js
│   ├── answers.js
│   ├── answers.test.js
│   ├── scoring.js
│   ├── scoring.test.js
│   ├── feedback-builder.js
│   ├── calculate-similarity.js
│   ├── calculate-similarity.test.js
│   └── complexity.js
│
├── bilingual/                # Bilingual display, translation, normalization
│   ├── bilingual-display.js
│   ├── bilingual-display.web.js
│   ├── bilingual-display.test.js
│   ├── bilingual-logic.js
│   ├── normalize.js
│   ├── normalize.test.js
│   ├── config-normalizer.js
│   └── config-normalizer.test.js
│
├── storage/                  # Data persistence (web IndexedDB + native AsyncStorage)
│   ├── storage.js                 # Router (FIXED)
│   ├── storage.web.js
│   ├── storage.native.js          # Stub — to create
│   ├── storage-adapter.js
│   ├── storage-adapter.native.js  # Stub — to create
│   └── storage-persistence-webonly.js
│
├── media/                    # Media playback, geo, referrer (platform-split)
│   ├── media.js                   # Router
│   ├── media.native.js
│   ├── media.web.js
│   ├── media.web.test.js
│   ├── geo-service.js             # Router
│   ├── geo-service.native.js
│   ├── geo-service.web.js
│   ├── referrer.js                # Router
│   ├── referrer.native.js
│   ├── referrer.web.js
│   └── navigation.native.js
│
├── utils/                    # Pure utilities (platform-agnostic)
│   ├── utils.js
│   ├── utils.test.js
│   ├── diff-utils.js
│   ├── idiom-checker.js
│   ├── swearjar.js
│   └── analytics.js
│
└── user/                     # User profile, auth, identity
    ├── user-profile.js
    ├── collect-signup-data.js
    ├── bot-identity.js
    ├── tutor-config.js
    ├── log-control-webonly.js
    └── demo-mode-webonly.js
```

### Files NOT moved (stay at js/modules/ root)
None — all 72 files move into subdirectories.

### Notes on target structure
- `store.test.js` confirmed to exist — imports `./store.js` (same directory, path stays correct after move)
- No barrel/index.js files exist in modules/ — no barrel re-export issues

---

## Phase 3: Update Import Paths

**CRITICAL: Phase 2, 3, and 4 are a single atomic commit.** You cannot run the app between Phase 2 and Phase 3 because imports will be broken. All file moves, import updates, and renames happen together, then the app is tested once.

### Import Path Change Map

Every import referencing `modules/<file>` must be updated to `modules/<domain>/<file>`. The changes are mechanical find-and-replace operations grouped by source location.

#### From `js/components/` (depth 1) — pattern `../modules/` → `../modules/<domain>/`

| File | Old Import | New Import |
|------|-----------|------------|
| `LessonContainer.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `LessonContainer.jsx` | `../modules/lesson-progression.js` | `../modules/lesson/lesson-progression.js` |
| `LessonContainer.jsx` | `../modules/lesson-loader.js` | `../modules/lesson/lesson-loader.js` |
| `step-loader.web.js` | `../modules/step-executor-webonly.js` | `../modules/lesson/step-executor-webonly.js` |
| `step-loader.web.js` | `../modules/speech.js` | `../modules/speech/speech.js` |
| `SimpleVideoPlayer.web.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `InteractiveVideoPlayer.web.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `PlaybackVideo.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `Preloader.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `StepLoader.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `PointLossOverlay.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `PointLossOverlay.test.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `IncomingVideoWidget.jsx` | `../modules/store.js` | `../modules/store/store.js` |
| `BilingualText.jsx` | `../modules/bilingual-display.js` | `../modules/bilingual/bilingual-display.js` |
| `BilingualText.native.jsx` | `../../modules/bilingual-display.js` | `../../modules/bilingual/bilingual-display.js` |
| `ui.test.js` | `../modules/store.js` | `../modules/store/store.js` |

#### From `js/components/widgets/` (depth 2) — pattern `../../modules/` → `../../modules/<domain>/`

All widget files importing `../../modules/store.js` → `../../modules/store/store.js` (18 files)

Other widget imports:
| File | Old | New |
|------|-----|-----|
| `MicrophoneToggle.web.jsx` | `../../modules/step-loader-callbacks.js` | `../../modules/lesson/step-loader-callbacks.js` |
| `AnswerInput.jsx` | `../../modules/step-loader-callbacks.js` | `../../modules/lesson/step-loader-callbacks.js` |
| `IntroChoices.jsx` | `../../modules/answer-pipeline.js` | `../../modules/answer/answer-pipeline.js` |
| `SuccessButtons.jsx` | `../../modules/video-processor.js` | `../../modules/video/video-processor.js` |
| `SuccessButtons.jsx` | `../../modules/success-lesson-logic.js` | `../../modules/lesson/success-lesson-logic.js` |
| `SuccessEffects.jsx` | `../../modules/success-lesson-logic.js` | `../../modules/lesson/success-lesson-logic.js` |
| `SuccessEffects.jsx` | `../../modules/media.js` | `../../modules/media/media.js` |
| `Hints.jsx` | `../../modules/bilingual-display.js` | `../../modules/bilingual/bilingual-display.js` |

#### From `js/components/chat/` (depth 2) — pattern `../../modules/` → `../../modules/<domain>/`

| File | Old | New |
|------|-----|-----|
| `chat-interface.js` | `../../modules/store.js` | `../../modules/store/store.js` |
| `chat-interface.js` | `../../modules/bot-identity.js` | `../../modules/user/bot-identity.js` |
| `ChatInterface.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |
| `GrammarDiffBubble.jsx` | `../../modules/diff-utils.js` | `../../modules/utils/diff-utils.js` |
| `GrammarDiffBubble.jsx` | `../../modules/bot-identity.js` | `../../modules/user/bot-identity.js` |
| `PragmaticsBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `AiLoadingBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `StatsBubble.jsx` | `../../modules/bot-identity.js` | `../../modules/user/bot-identity.js` |
| `SystemBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `UserBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `PossibleAnswerBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `TeacherFeedbackBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `ContinueWidgetBubble.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |
| `ContinueWidgetBubble.jsx` | `../../modules/tutor-config.js` | `../../modules/user/tutor-config.js` |
| `VideoBubble.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |
| `ChatHeader.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |

#### From `js/components/modals/` (depth 2)

| File | Old | New |
|------|-----|-----|
| `GuestLoginModal.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |
| `CriticalErrorModal.jsx` | `../../modules/store.js` | `../../modules/store/store.js` |

#### From `js/hooks/` (depth 1) — pattern `../modules/` → `../modules/<domain>/`

| File | Old | New |
|------|-----|-----|
| `app-infra-webonly.js` | `../modules/store.js` | `../modules/store/store.js` |
| `app-infra-webonly.js` | `../modules/user-profile.js` | `../modules/user/user-profile.js` |
| `app-infra-webonly.js` | `../modules/scoring.js` | `../modules/answer/scoring.js` |
| `app-infra-webonly.js` | `../modules/media.js` | `../modules/media/media.js` |
| `app-infra-webonly.js` | `../modules/lesson-progression.js` | `../modules/lesson/lesson-progression.js` |
| `app-infra-webonly.js` | `../modules/lesson-loader.js` | `../modules/lesson/lesson-loader.js` |
| `app-infra-webonly.js` | `../modules/answer-pipeline.js` | `../modules/answer/answer-pipeline.js` |
| `app-infra-webonly.js` | `../modules/api.js` | `../modules/api/api.js` |
| `app-infra-webonly.js` | `../modules/speech.js` | `../modules/speech/speech.js` |
| `use-app-bootstrap-webonly.js` | `../modules/store.js` | `../modules/store/store.js` |
| `use-app-bootstrap-webonly.js` | `../modules/storage-persistence-webonly.js` | `../modules/storage/storage-persistence-webonly.js` |
| `use-app-bootstrap-webonly.js` | `../modules/api.js` | `../modules/api/api.js` |
| `use-app-bootstrap-webonly.js` | `../modules/user-profile.js` | `../modules/user/user-profile.js` |
| `use-initialize-lesson-webonly.js` | `../modules/store.js` | `../modules/store/store.js` |
| `use-initialize-lesson-webonly.js` | `../modules/lessonRouting.js` | `../modules/lesson/lesson-routing.js` |
| `use-initialize-lesson-webonly.js` | `../modules/user-profile.js` | `../modules/user/user-profile.js` |
| `use-initialize-lesson-webonly.js` | `../modules/lesson-loader.js` | `../modules/lesson/lesson-loader.js` |
| `useInteractiveVideo.js` | `../modules/store.js` | `../modules/store/store.js` |
| `useInteractiveVideo.js` | `../modules/interactive-video-controller.js` | `../modules/video/interactive-video-controller.js` |
| `useSimpleVideo.js` | `../modules/store.js` | `../modules/store/store.js` |
| `useSimpleVideo.js` | `../modules/simple-video-controller.js` | `../modules/video/simple-video-controller.js` |
| `usePreloader.js` | `../modules/store.js` | `../modules/store/store.js` |
| `usePlaybackVideo.js` | `../modules/store.js` | `../modules/store/store.js` |

#### From `js/workers/whisper/` (depth 3) — pattern `../../modules/` → `../../modules/<domain>/`

| File | Old | New |
|------|-----|-----|
| `app-vad-asr-web.js` | `../../modules/store.js` | `../../modules/store/store.js` |

#### From `js/` root (depth 0) — pattern `./modules/` → `./modules/<domain>/`

| File | Old | New |
|------|-----|-----|
| `js/index.jsx` | `./modules/api.js` | `./modules/api/api.js` |
| `js/App.jsx` | `./modules/speech.js` | `./modules/speech/speech.js` |
| `js/App.jsx` | `./modules/idiom-checker.js` | `./modules/utils/idiom-checker.js` |

#### From `app/` (cross-root) — pattern `../js/modules/` → `../js/modules/<domain>/`

| File | Old | New |
|------|-----|-----|
| `app/AppLayout.jsx` | `../js/modules/store.js` | `../js/modules/store/store.js` |
| `app/AppLayout.jsx` | `../js/modules/config-normalizer.js` | `../js/modules/bilingual/config-normalizer.js` |

#### From `tests/` (absolute Vite dev server paths)

| File | Old | New |
|------|-----|-----|
| `tests/answer-flow.spec.js` | `/js/modules/answer-pipeline.js` | `/js/modules/answer/answer-pipeline.js` |
| `tests/e2e-smoke.spec.js` | `/js/modules/answer-pipeline.js` | `/js/modules/answer/answer-pipeline.js` |
| `tests/regression-guard.spec.js` | `/js/modules/lesson-loader.js` | `/js/modules/lesson/lesson-loader.js` |
| `tests/regression-guard.spec.js` | `/js/modules/step-loader-logic.js` | `/js/modules/lesson/step-loader-logic.js` |
| `tests/whisper-review.spec.js` | `/js/modules/step-loader-logic.js` | `/js/modules/lesson/step-loader-logic.js` |

#### Internal cross-references within modules/ — pattern `./` → relative to new location

After moving files into subdirectories, internal `./` imports between files in the SAME subdirectory stay as `./`. Only imports between DIFFERENT subdirectories change.

Example: `answer-pipeline.js` imports from `./scoring.js` — both move to `answer/`, so this stays as `./scoring.js`.

Example: `speech.js` imports from `./storage.js` — speech moves to `speech/`, storage moves to `storage/`, so this becomes `../storage/storage.js`.

**Key internal cross-references that cross subdirectory boundaries:**

| Source (new location) | Old Import | New Import |
|---|---|---|
| `speech/speech.js` | `./storage.js` | `../storage/storage.js` |
| `speech/speech.js` | `./demo-mode-webonly.js` | `../user/demo-mode-webonly.js` |
| `speech/speech.web.js` | (internal to speech/) | stays `./` |
| `video/video-processor.web.js` | `./storage.js` | `../storage/storage.js` |
| `video/video-processor.web.js` | `./video-processor-logic.js` | stays `./` |
| `video/video-processor.web.js` | `./video-share.js` | stays `./` |
| `video/video-processor.web.js` | `./store.js` | `../store/store.js` |
| `lesson/step-executor-webonly.js` | `../modules/store.js` | `../store/store.js` |
| `lesson/step-executor-webonly.js` | `../modules/utils.js` | `../utils/utils.js` |
| `lesson/step-executor-webonly.js` | `../modules/answers.js` | `../answer/answers.js` |
| `lesson/step-executor-webonly.js` | `../modules/scoring.js` | `../answer/scoring.js` |
| `lesson/step-executor-webonly.js` | `../modules/step-loader-logic.js` | stays `./` |
| `lesson/step-executor-webonly.js` | `../modules/step-loader-orchestrate.js` | stays `./` |
| `lesson/success-lesson-logic.js` | (no module imports — pure logic) | no changes needed |
| `answer/answer-pipeline.js` | (internal to answer/) | stays `./` |
| `user/demo-mode-webonly.js` | (web-only, uses window.*) | no module imports to update |
| `storage/storage-adapter.js` | (no imports) | no changes |

---

## Phase 4: Fix Naming Inconsistencies (while moving)

1. `lessonRouting.js` → `lesson-routing.js` (kebab-case to match convention)
2. `video-processor-native.jsx` → `video-processor.native.jsx` (match platform suffix convention)
3. `step-executor-webonly.js` internal imports: fix the anomalous `../modules/` paths. **The Phase 3 internal cross-references table (lines 294-299) is authoritative for this file.** Summary: same-directory imports (`step-loader-logic.js`, `step-loader-orchestrate.js`) become `./`; cross-directory imports (`store.js`, `utils.js`, `answers.js`, `scoring.js`) become `../domain/file.js` as specified in the Phase 3 table.

---

## Execution Order

**Phase 1 is a separate commit. Phases 2+3+4 are a single atomic commit.**

1. **Phase 1 first** — Fix the 3 platform routing bugs. Test that the app still loads on web. Commit.
2. **Phases 2+3+4 together** — Create subdirectories, move files, rename files, update all import paths in one pass. Test. Commit.

You cannot run the app between Phase 2 and Phase 3 — imports will be broken until all paths are updated.

---

## Verification

After Phase 1 (bug fixes):
1. Run `npm run dev` — app should load without console errors
2. Run the smoke test: `npx playwright test tests/smoke.spec.js`

After Phases 2+3+4 (restructure):
1. Run `npm run dev` — app should load without console errors
2. Run the smoke test: `npx playwright test tests/smoke.spec.js`
3. Run the answer flow test: `npx playwright test tests/answer-flow.spec.js`
4. Verify Vite build succeeds: `npm run build`
5. Run full test suite: `npx playwright test`
6. Grep for orphaned imports — ALL FOUR patterns:
   ```
   grep -r "from.*\.\./modules/" js/
   grep -r "from.*\.\./\.\./modules/" js/
   grep -r "from.*\./modules/" js/
   grep -r "from.*'/js/modules/" tests/
   ```
   Any matches indicate missed import updates.

---

## Risk Assessment

- **Low risk:** Phase 1 (bug fixes) — these are clearly broken and the fixes are straightforward
- **Medium risk:** Phases 2+3+4 (restructure) — large number of import changes (~183), but they're mechanical find-and-replace. The main risk is missing an import, which would surface as a build/runtime error
- **Mitigation:** The four grep patterns in verification will catch any orphaned imports

---

## What This Does NOT Change

- No files outside `js/modules/` are moved
- No component files are reorganized (that's a separate task)
- The `app/` directory stays as-is (merging it is a separate decision)
- No new dependencies are added
- The Vite config stays the same
- Test file locations stay co-located with their source files
