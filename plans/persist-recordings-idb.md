# Plan: Persist User-Recorded Videos Across Page Reloads via IndexedDB

## Goal

Recordings currently live in a module-scoped `Map` (`recordingsMap`) in
`src/modules/storage/storage.web.js`. They survive SPA navigation but are **lost on a
full page reload**. This plan adds an IndexedDB-backed persistence layer so recordings
survive reloads, while keeping the existing in-memory `Map` as the hot cache for the
current session.

## Architecture (decisions already locked in)

| Decision | Choice | Rationale |
|---|---|---|
| Storage backend | IndexedDB (via `idb-keyval`) | localStorage is too small and blocks the main thread; IndexedDB is async with a large quota. |
| Serialization | `ArrayBuffer` (NOT data URL strings, NOT raw `Blob`) | `ArrayBuffer` is a structured-clone primitive — avoids the WebKit "Error preparing Blob/File to be stored in object store" bug that caused the previous IndexedDB removal (`plans/indexeddb-remove.md:5`). Avoids the 33% base64 bloat of data URLs. |
| Record granularity | One record per `(lessonId, stepIndex)` — latest write wins | Matches how `updateSpeechRecording` and `VideoRenderPlanner` actually use recordings (per-step, not per-timestamp). |
| What is stored | The **entire** in-memory record (swap `blob` → `arrayBuffer`) | An explicit field allowlist would silently drop fields the video planner reads (`userResponse`, `isTextMode`, `translation`, `duration`, `cue`, `matchedCue`, `responseType`, `title`, `wpm`, `pauseCount`, `complexityScore`). Persisting the whole record guarantees field-parity by construction. |
| Zustand | **No changes** | IndexedDB is the single source of truth for persisted recordings. No dual-store, no `partialize` additions. |
| Cross-lesson cleanup | On `loadLessonContent`, delete IDB entries for all lessons except the one being loaded | Recordings from past lessons become unrecoverable (acceptable — no cross-lesson replay feature). Bounds IndexedDB growth. |

---

## Files Changed

| File | Action | Summary |
|---|---|---|
| `package.json` | Edit | Add `idb-keyval` dependency. |
| `src/modules/storage/recordingDb.js` | **New file** | Thin IndexedDB helper using `idb-keyval`. |
| `src/modules/storage/storage.web.js` | Edit | Add persistence to `saveSpeechRecording`, `updateSpeechRecording`, `getAllSpeechRecordingsForLesson`, `clearSpeechRecordingsForLesson`. |
| `src/modules/lesson/lesson-loader.js` | Edit | On `loadLessonContent`, delete other lessons' IDB entries. |

**Files NOT changed** (verified — no edits needed):
- `src/modules/storage/storage.js` (barrel: `export * from './storage.web.js'` — new exports auto-propagate).
- `src/modules/storage/storage.native.js` (separate React Native stub).
- `src/modules/speech/speech.web.js` (calls `saveSpeechRecording` — signature unchanged).
- `src/modules/speech/speech-orchestrator.js` (calls `updateSpeechRecording` fire-and-forget — signature unchanged).
- `src/modules/answer/answer-pipeline.js` (calls `saveSpeechRecording` + `updateSpeechRecording` — signatures unchanged).
- `src/modules/video/video-processor.web.js`, `video-processor-logic.js` (consume `getAllSpeechRecordingsForLesson` — return shape unchanged: array of records with `.blob`).
- `src/modules/store/store.js` (no recording state; no `partialize` change).

---

## Step 0 — Install `idb-keyval`

Add `idb-keyval` (~600 bytes gzipped) to `package.json` under `dependencies` (alphabetical —
insert before `mediabunny`):

```jsonc
    "idb-keyval": "^6.0.3",
```

Then run:
```bash
npm install
```

Verify it resolves in `package-lock.json`.

---

## Step 1 — Create `src/modules/storage/recordingDb.js`

A new, self-contained helper. All functions are `async` and return Promises. Keys are
strings of the form `recording:<lessonId>:<stepIndex>`. Values are plain-serializable
record objects (no `Blob` — the video bytes are carried as `arrayBuffer`).

```js
// src/modules/storage/recordingDb.js
// IndexedDB-backed persistence for speech recordings via idb-keyval.
// Stores one record per (lessonId, stepIndex). Values are plain objects
// containing an `arrayBuffer` (for webcam recordings) or `arrayBuffer: null`
// (for text-mode recordings) — never a raw Blob, which triggers the WebKit
// "Error preparing Blob/File to be stored in object store" bug.

import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'recording:';
const keyFor = (lessonId, stepIndex) => `${PREFIX}${lessonId}:${stepIndex}`;

/**
 * Persist (or overwrite) a recording record for a given lesson + step.
 * The record must be structured-cloneable: the video payload lives under
 * `record.arrayBuffer` (an ArrayBuffer or null), never a Blob.
 */
export async function putRecord(lessonId, stepIndex, record) {
    await set(keyFor(lessonId, stepIndex), record);
}

/**
 * Read a single recording record. Returns `undefined` if not found.
 */
export async function getRecord(lessonId, stepIndex) {
    return get(keyFor(lessonId, stepIndex));
}

/**
 * Return all persisted recording records for a lesson, as an array.
 * Deterministic order is NOT guaranteed here — the caller sorts.
 */
export async function listRecordsForLesson(lessonId) {
    const allKeys = await keys();
    const prefix = `${PREFIX}${lessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(prefix)
    );
    const records = await Promise.all(matchingKeys.map((k) => get(k)));
    return records.filter(Boolean);
}

/**
 * Delete all persisted recording records for a lesson.
 */
export async function deleteRecordsForLesson(lessonId) {
    const allKeys = await keys();
    const prefix = `${PREFIX}${lessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(prefix)
    );
    await Promise.all(matchingKeys.map((k) => del(k)));
}

/**
 * Delete all persisted recording records for every lesson EXCEPT the one
 * named by `keepLessonId`. Called on lesson load to bound IDB growth —
 * there is no cross-lesson replay, so old lessons' recordings are
 * unrecoverable by design.
 */
export async function deleteRecordsExceptLesson(keepLessonId) {
    const allKeys = await keys();
    const keepPrefix = `${PREFIX}${keepLessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(PREFIX) && !k.startsWith(keepPrefix)
    );
    await Promise.all(matchingKeys.map((k) => del(k)));
}
```

### Design notes for the implementer
- **Do NOT store `Blob` objects** anywhere in this file. The entire reason the previous
  IndexedDB layer was removed (`plans/indexeddb-remove.md:5`) was the WebKit bug triggered
  by `Blob`/`File` values. `ArrayBuffer` is a structured-clone primitive and is immune.
- `keys()` returns all keys in the default store. Filtering by string prefix is O(n) over
  the key set, which is tiny (one key per step, one lesson at a time ≈ ≤ 20). Fine.
- All functions are `async` — callers must `await`. Every existing call site already
  `await`s the storage functions (verified), so this is safe.

---

## Step 2 — Modify `src/modules/storage/storage.web.js`

This is the core change. The existing file is 80 lines (read it in full before editing).
The public function signatures stay identical so callers need no changes. Below are the
**exact replacements** for each function.

### 2.1 — Add imports + helpers at the top of the file

Replace lines 1–4:

```js
// modules/storage.web.js

import { appStore } from '../store/store.js';
import { putRecord, getRecord, listRecordsForLesson, deleteRecordsForLesson } from './recordingDb.js';

const recordingsMap = new Map();

// Monotonic counter to guarantee unique Map keys even when two
// saveSpeechRecording calls land in the same millisecond (e.g. rapid
// text-mode answers). Date.now() alone is not sufficient — see review note.
let _nextRecordingSeq = 0;

// --- Blob <-> ArrayBuffer serialization -------------------------------------
// We store video bytes as ArrayBuffer (structured-cloneable) rather than Blob
// (triggers the WebKit IndexedDB Blob bug) or data URL strings (33% base64
// bloat). Conversion is async on save, sync on restore.

async function blobToArrayBuffer(blob) {
    // Blob.arrayBuffer() is async, non-blocking, and supported in all modern
    // browsers (Safari 14+). Fall back to FileReader for very old Safari.
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

function arrayBufferToBlob(arrayBuffer, mimeType) {
    // Synchronous — ArrayBuffer → Blob is a cheap wrapper, no I/O.
    return new Blob([arrayBuffer], { type: mimeType || 'video/webm' });
}
```

### 2.2 — `saveSpeechRecording` — persist the whole record after the in-memory set

Replace the current `saveSpeechRecording` (lines 7–30). The in-memory `Map` is updated
identically to before (the hot cache for the current session). After that, the entire
record is serialized and written to IndexedDB. The write is wrapped in try/catch so a
failure (private mode, quota) degrades gracefully to "in-memory only for this session."

```js
export async function saveSpeechRecording(blob, meta = {}) {
  const storeState = appStore.getState();
  const lessonId = meta.lessonId
    ?? storeState.activeLessonId
    ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId
    ?? 'unknown_lesson';
  const stepIndex = meta.stepIndex ?? storeState.currentStepIndex ?? 0;
  const timestamp = Date.now();
  const seq = _nextRecordingSeq++;
  const videoKey = `uffvideo_${lessonId}_${stepIndex}_${timestamp}_${seq}`;

  const record = {
    id: videoKey,
    createdAt: timestamp,
    mimeType: blob ? blob.type : 'video/webm',
    size: blob ? blob.size : 0,
    blob,
    ...meta,
    originalLessonId: lessonId,
    originalStepIndex: stepIndex,
  };

  // Hot cache: in-memory Map (unchanged behavior for the current session).
  recordingsMap.set(videoKey, record);
  console.log('[Storage] saveSpeechRecording stored in memory', { lessonId, stepIndex, hasBlob: !!blob, key: videoKey });

  // Persistence: write the whole record to IndexedDB, keyed by (lessonId,
  // stepIndex) so latest-write-wins matches updateSpeechRecording and the
  // planner. Video bytes are serialized to ArrayBuffer — never a Blob.
  try {
    const arrayBuffer = blob ? await blobToArrayBuffer(blob) : null;
    const { blob: _omit, ...serializable } = record;
    await putRecord(lessonId, stepIndex, { ...serializable, arrayBuffer });
    console.log('[Storage] saveSpeechRecording persisted to IndexedDB', { lessonId, stepIndex, hasBlob: !!blob });
  } catch (err) {
    // IndexedDB write failed (quota, private mode, etc.). The in-memory entry
    // still covers the current session — recordings will just not survive a
    // full page reload. Log and continue; do not throw.
    console.warn('[Storage] Failed to persist recording to IndexedDB', err);
  }

  return videoKey;
}
```

Key points:
- **The `blob` field is stripped** before persistence (`const { blob: _omit, ...serializable } = record`) because `Blob` is the value that triggers the WebKit bug. The bytes live under `arrayBuffer` instead.
- **Text-mode recordings (`blob: null`) are persisted too.** `arrayBuffer` will be `null`. This is critical — text-mode recordings are real segments in the video pipeline (`video-processor.web.js:358,473,514,563` branch on `isTextMode`).
- **Every meta field is preserved** (`...meta` is spread into the record, and the whole record minus `blob` is persisted). This includes `userResponse`, `isTextMode`, `translation`, `duration`, `cue`, `matchedCue`, `responseType`, `title`, etc. No allowlist.
- Per `AGENTS.md` §2, add success and failure logs. Keep the existing console.log style.

### 2.3 — `getAllSpeechRecordingsForLesson` — MERGE by step index (critical)

Replace the current `getAllSpeechRecordingsForLesson` (lines 32–41). **This is the most
important function in the plan.** The naive "if in-memory has anything, return it; else
fall back to IndexedDB" approach is **wrong**: on a mid-lesson reload, earlier steps exist
only in IndexedDB and later steps exist only in the in-memory `Map`. An all-or-nothing
check would silently drop the earlier steps, producing a stitch video missing its first
segments — and the planner (`video-processor-logic.js:18-72`) does not fill gaps from
configData, so missing input = missing output.

The merge logic:
1. **In-memory entries take priority** (current session, freshest).
2. **IndexedDB fills in any step not already covered** by an in-memory entry.

```js
export async function getAllSpeechRecordingsForLesson(lessonId) {
  // 1. Collect in-memory records keyed by stepIndex (in-memory wins on conflict).
  const byStep = new Map(); // stepIndex -> record
  for (const record of recordingsMap.values()) {
    if (record.originalLessonId === lessonId) {
      // A later in-memory entry for the same step is fresher — keep the latest.
      const existing = byStep.get(record.originalStepIndex);
      if (!existing || (record.createdAt ?? 0) >= (existing.createdAt ?? 0)) {
        byStep.set(record.originalStepIndex, record);
      }
    }
  }

  // 2. Fill in any steps that exist only in IndexedDB.
  let persisted;
  try {
    persisted = await listRecordsForLesson(lessonId);
  } catch (err) {
    // IndexedDB read failed (private mode, corrupted, etc.). Degrade to
    // in-memory-only — still returns everything the current session recorded.
    console.warn('[Storage] Failed to read recordings from IndexedDB', err);
    persisted = [];
  }

  for (const rec of persisted) {
    if (byStep.has(rec.originalStepIndex)) continue; // in-memory already covers this step

    // Rehydrate the Blob from ArrayBuffer. Text-mode recordings have
    // arrayBuffer === null → blob stays null — the planner's isTextMode
    // branch handles them identically to a fresh text-mode answer.
    const blob = rec.arrayBuffer ? arrayBufferToBlob(rec.arrayBuffer, rec.mimeType) : null;
    const restored = {
      ...rec,
      blob,
      // Ensure a stable, unique id for the rehydrated record in the Map.
      id: rec.id || `restored_${lessonId}_${rec.originalStepIndex}`,
      arrayBuffer: undefined, // drop the ArrayBuffer field — consumers want `blob`, not raw bytes
    };
    recordingsMap.set(restored.id, restored);
    byStep.set(restored.originalStepIndex, restored);
    console.log('[Storage] getAllSpeechRecordingsForLesson restored from IndexedDB', { lessonId, stepIndex: rec.originalStepIndex, hasBlob: !!blob });
  }

  const results = Array.from(byStep.values());
  results.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  console.log('[Storage] getAllSpeechRecordingsForLesson', { lessonId, count: results.length, steps: Array.from(byStep.keys()).sort((x, y) => x - y) });
  return results;
}
```

Key points:
- The returned record shape is **identical to the old return shape**: an array of `{ id, createdAt, mimeType, size, blob, userResponse, isTextMode, translation, duration, cue, matchedCue, responseType, title, originalLessonId, originalStepIndex, ... }` objects with a native `blob` field. Consumers (`video-processor.web.js:130,153`, `video-processor-logic.js:52-61`) are unchanged.
- The `arrayBuffer` field is set to `undefined` on the restored record so consumers that spread the record don't accidentally carry the raw bytes around (they want `blob`, not `arrayBuffer`). The in-memory records never had `arrayBuffer` to begin with, so this keeps both shapes aligned.
- **In-memory dedupe**: if the Map somehow has two entries for the same step (latent pre-existing bug — `saveSpeechRecording` keys by timestamp, not step), the latest by `createdAt` wins. This doesn't fully fix the latent duplicate-segment bug (see §5 note) but prevents it from compounding with IndexedDB merge.

### 2.4 — `clearSpeechRecordingsForLesson` — also clear IndexedDB

Replace the current `clearSpeechRecordingsForLesson` (lines 43–53). Adds the IndexedDB
delete. Gated on `forceRestart` by the caller (`lesson-loader.js:13`), so this only runs
on explicit Repeat — normal lesson loads preserve recordings (intentional — that's what
lets them survive navigation).

```js
export async function clearSpeechRecordingsForLesson(lessonId) {
  const toDelete = [];
  for (const [key, record] of recordingsMap) {
    if (record.originalLessonId === lessonId) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) {
    recordingsMap.delete(key);
  }

  try {
    await deleteRecordsForLesson(lessonId);
    console.log('[Storage] clearSpeechRecordingsForLesson cleared IndexedDB', { lessonId });
  } catch (err) {
    console.warn('[Storage] Failed to clear recordings from IndexedDB', err);
  }
}
```

### 2.5 — `updateSpeechRecording` — also persist (self-healing)

Replace the current `updateSpeechRecording` (lines 55–80). This is the piece the earlier
draft missed entirely. Two call sites in `answer-pipeline.js:585,682` (awaited) and three
in `speech-orchestrator.js:63,81,147` (fire-and-forget with `.catch(e => console.error(e))`)
call this **after** `saveSpeechRecording` to merge in `userResponse`, `matchedCue`,
`translation`, `duration`, `wpm`, `pauseCount`, `complexityScore`. Without persisting
here, the IndexedDB record is a stale pre-update snapshot missing the user's actual
response text and analytics.

It also **self-heals** a failed initial save: if `getRecord` returns `undefined` (meaning
`saveSpeechRecording`'s `putRecord` threw) but the in-memory record has a `blob`, we
re-serialize from the in-memory blob so the video bytes aren't permanently lost from IDB.

```js
export async function updateSpeechRecording(lessonId, stepIndex, updates = {}) {
  const storeState = appStore.getState();
  const resolvedLessonId = lessonId
    ?? storeState.activeLessonId
    ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId
    ?? 'unknown_lesson';
  const resolvedStepIndex = stepIndex ?? storeState.currentStepIndex ?? 0;

  // --- In-memory merge (unchanged) ---
  const matching = [];
  for (const [, record] of recordingsMap) {
    if (record.originalLessonId === resolvedLessonId
        && record.originalStepIndex === resolvedStepIndex) {
      matching.push(record);
    }
  }
  if (matching.length === 0) {
    console.warn('[Storage] updateSpeechRecording: no record found for', resolvedLessonId, resolvedStepIndex);
    return null;
  }

  matching.sort((a, b) => b.createdAt - a.createdAt);
  const latest = matching[0];
  const updatedRecord = { ...latest, ...updates };
  recordingsMap.set(latest.id, updatedRecord);

  // --- Persist the merged record to IndexedDB ---
  try {
    const existing = await getRecord(resolvedLessonId, resolvedStepIndex);

    // Self-heal: if the initial save failed (existing === undefined) but the
    // in-memory record has a blob, serialize it now so the video bytes aren't
    // permanently lost from IDB.
    let arrayBuffer = existing?.arrayBuffer ?? null;
    if (!arrayBuffer && updatedRecord.blob) {
      arrayBuffer = await blobToArrayBuffer(updatedRecord.blob);
    }

    const { blob: _omit, ...serializable } = updatedRecord;
    await putRecord(resolvedLessonId, resolvedStepIndex, {
      ...serializable,
      arrayBuffer,
    });
    console.log('[Storage] updateSpeechRecording persisted to IndexedDB', { lessonId: resolvedLessonId, stepIndex: resolvedStepIndex, keys: Object.keys(updates) });
  } catch (err) {
    // Non-fatal: in-memory entry is already updated. A failure here means the
    // update won't survive a reload, but the current session is unaffected.
    console.warn('[Storage] Failed to persist recording update to IndexedDB', err);
  }

  return latest.id;
}
```

Key points:
- The in-memory merge logic is **unchanged** — only persistence is added after it.
- The returned value (`latest.id`) is unchanged.
- The fire-and-forget callers in `speech-orchestrator.js` already attach `.catch(e => console.error(e))`. The internal try/catch means an IDB failure logs a `console.warn` and does **not** throw, so the `.catch` won't fire for IDB errors — that's fine; the warn is the visible signal.

---

## Step 3 — Modify `src/modules/lesson/lesson-loader.js`

Add cross-lesson cleanup: on every lesson load, delete IDB entries for all lessons other
than the one being loaded. This bounds IDDB growth (one lesson's recordings ≈ 4–12MB;
without cleanup, navigating across many lessons in a long session would grow unbounded).

The current file (66 lines) imports only `clearSpeechRecordingsForLesson` from storage.
Add an import for the cleanup helper and call it early in `loadLessonContent`.

### 3.1 — Update the import (line 2)

```js
import { clearSpeechRecordingsForLesson } from '../storage/storage.js';
import { deleteRecordsExceptLesson } from '../storage/recordingDb.js';
```

### 3.2 — Add cleanup inside `loadLessonContent`

Insert the cleanup **before** the existing `if (forceRestart)` block (so other lessons'
recordings are cleared regardless of whether this is a restart). Wrap in try/catch so a
failure doesn't break lesson loading.

```js
export async function loadLessonContent(lesson, options = {}) {
    const { forceRestart = false } = options;

    // Reclaim IndexedDB space from other lessons. There is no cross-lesson
    // replay, so recordings from lessons the user navigated away from are
    // safe to delete. This is independent from forceRestart, which clears the
    // CURRENT lesson's recordings (Repeat button).
    try {
        await deleteRecordsExceptLesson(lesson.lessonId);
        console.log('[LessonLoader] cleared IndexedDB recordings for other lessons');
    } catch (e) {
        console.warn('[LessonLoader] failed to clear other lessons recordings', e);
    }

    // Only clear the current lesson's recordings on explicit restart.
    if (forceRestart) {
        try {
            await clearSpeechRecordingsForLesson(lesson.lessonId);
        } catch (e) {
            console.error(e);
        }
    }

    // ...rest of loadLessonContent unchanged...
```

### Design notes
- **Order matters**: `deleteRecordsExceptLesson` runs before `clearSpeechRecordingsForLesson`. On a fresh lesson load (not restart), the current lesson's earlier-session recordings in IDB are *preserved* (only other lessons are cleared) — this is what enables mid-lesson reload to pick back up.
- On a Repeat (`forceRestart`), the current lesson's recordings are cleared both from IDB and memory, and other lessons were already cleared by the first call. Net effect: only the recordings being made this session remain.
- The in-memory `recordingsMap` is **not** cleared for other lessons by this. It only ever holds the current session's recordings, and `clearSpeechRecordingsForLesson` handles the current lesson on restart. Stale entries for other lessons in the Map are harmless (they'd only re-appear in `getAll` if filtered by that lesson, which won't happen this session).

---

## Step 4 — Verification

### 4.1 — Run the dev server
```bash
npm run dev
```
Open `http://localhost:3000/course/model/lesson/g` and confirm no console errors at load time (the smoke per `AGENTS.md` §4).

### 4.2 — Run the existing smoke test
```bash
npx playwright test tests/answer-flow.spec.js
```
This exercises `submitAnswerPrecheck` / `handleAnswer` → `saveSpeechRecording` + `updateSpeechRecording` → (new) IndexedDB writes. It must still pass and produce **no** unexpected console errors/warnings.

### 4.3 — Run the text-mode test
```bash
npx playwright test tests/text-mode-video.spec.js
```
This exercises `saveSpeechRecording(null, { isTextMode: true, ... })` and then `processVideo`. It verifies that:
- Text-mode recordings (no blob) are persisted with `arrayBuffer: null`.
- They're rehydrated and the planner's `isTextMode` branch still produces a 3-second profile-image clip.
- `result.size > 0` and `result.ext ∈ ['mp4', 'webm']`.

### 4.4 — Manual reload-resilience check (Playwright or devtools)
Since there's no existing test for reload resilience, verify manually in the dev server:
1. Navigate to `http://localhost:3000/course/model/lesson/g`.
2. Open DevTools → Application → IndexedDB → confirm a `keyval-store` database appears after answering a step.
3. Complete 1–2 steps (text-mode is easiest — no mic needed).
4. Run in console: `await import('/src/modules/storage/storage.js').then(m => m.getAllSpeechRecordingsForLesson('model_lec_g'))` — confirm records are present.
5. **Reload the page** (`location.reload()`).
6. Run the `getAllSpeechRecordingsForLesson` call again — confirm the **same** records are still returned (this is the whole point of the change).
7. Inspect one record: confirm it has `blob` (a `Blob`), `userResponse`, `isTextMode`, `duration`, `cue` — all fields populated.
8. Trigger the Repeat button — confirm `clearSpeechRecordingsForLesson` runs and `getAllSpeechRecordingsForLesson` returns `[]` afterward.

> **Note:** Step 0–1 of the manual check (the exact lessonId) depends on the active config. Use `window.appStore.getState().activeLessonId` to get the real value. `'model_lec_g'` is an example placeholder.

### 4.4b — Write an automated reload-resilience test

Add a new Playwright test file `tests/recording-persistence.spec.js` to automate the manual check above. This is cheap insurance against regressions in the merge/sort logic and the serializing/deserializing round-trip — exactly the kind of thing that's easy to get subtly wrong (per review feedback).

```js
// tests/recording-persistence.spec.js
// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Recording Persistence', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401'];
                if (!noise.some(n => text.includes(n))) errors.push(text);
            }
        });
    });

    test('text-mode recordings survive a full page reload', async ({ page }) => {
        test.setTimeout(60000);

        // Phase 1: navigate, set text mode, save a recording.
        await page.goto('/course/model/lesson/g');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const lessonId = await page.evaluate(async () => {
            const state = window.appStore.getState();
            const lessonId = state.activeLessonId || 'model';

            window.appStore.setState({
                userData: { ...(state.userData || {}), profilePictureUrl: '/assets/img/userprofile.png' },
                isTextMode: true
            });

            const { saveSpeechRecording, clearSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lessonId);
            await saveSpeechRecording(null, {
                lessonId,
                stepIndex: 0,
                userResponse: 'Persistence test answer',
                isTextMode: true,
                duration: 3,
            });
            const { updateSpeechRecording } = await import('/src/modules/storage/storage.js');
            await updateSpeechRecording(lessonId, 0, { matchedCue: 'test cue', translation: 'test translation' });

            return lessonId;
        });

        // Phase 2: reload the page.
        await page.reload();
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        // Phase 3: verify the recording survived the reload.
        const restored = await page.evaluate(async (lid) => {
            const { getAllSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            const recordings = await getAllSpeechRecordingsForLesson(lid);
            return recordings.map(r => ({
                stepIndex: r.originalStepIndex,
                userResponse: r.userResponse,
                isTextMode: r.isTextMode,
                duration: r.duration,
                matchedCue: r.matchedCue,
                translation: r.translation,
                hasBlob: !!r.blob,
                size: r.size,
            }));
        }, lessonId);

        expect(restored.length).toBe(1);
        expect(restored[0].userResponse).toBe('Persistence test answer');
        expect(restored[0].isTextMode).toBe(true);
        expect(restored[0].duration).toBe(3);
        expect(restored[0].matchedCue).toBe('test cue');
        expect(restored[0].translation).toBe('test translation');

        // Phase 4: Repeat button clears it.
        await page.evaluate(async (lid) => {
            const { clearSpeechRecordingsForLesson, getAllSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lid);
            const remaining = await getAllSpeechRecordingsForLesson(lid);
            return remaining.length;
        }).then(len => expect(len).toBe(0));

        if (errors.length > 0) throw new Error(`Console errors:\n${errors.join('\n')}`);
    });

    test('multiple steps survive reload and merge with fresh in-memory recordings', async ({ page }) => {
        test.setTimeout(60000);

        await page.goto('/course/model/lesson/g');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const lessonId = await page.evaluate(async () => {
            const state = window.appStore.getState();
            const lessonId = state.activeLessonId || 'model';
            window.appStore.setState({
                userData: { ...(state.userData || {}), profilePictureUrl: '/assets/img/userprofile.png' },
                isTextMode: true
            });
            const { saveSpeechRecording, clearSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lessonId);
            // Save steps 0 and 1 (persisted to IDB).
            await saveSpeechRecording(null, { lessonId, stepIndex: 0, userResponse: 'answer 0', isTextMode: true, duration: 3 });
            await saveSpeechRecording(null, { lessonId, stepIndex: 1, userResponse: 'answer 1', isTextMode: true, duration: 3 });
            return lessonId;
        });

        // Reload — steps 0 and 1 are now only in IDB.
        await page.reload();
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        // Simulate recording step 2 fresh this session (in-memory only initially).
        await page.evaluate(async (lid) => {
            const { saveSpeechRecording } = await import('/src/modules/storage/storage.js');
            await saveSpeechRecording(null, { lessonId: lid, stepIndex: 2, userResponse: 'answer 2', isTextMode: true, duration: 3 });
            return lid;
        }, lessonId);

        // getAll must merge: steps 0+1 from IDB + step 2 from in-memory.
        const merged = await page.evaluate(async (lid) => {
            const { getAllSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            const recordings = await getAllSpeechRecordingsForLesson(lid);
            return recordings.map(r => ({ stepIndex: r.originalStepIndex, userResponse: r.userResponse }));
        }, lessonId);

        expect(merged.length).toBe(3);
        expect(merged.map(r => r.userResponse)).toEqual(['answer 0', 'answer 1', 'answer 2']);

        if (errors.length > 0) throw new Error(`Console errors:\n${errors.join('\n')}`);
    });
});
```

Run it:
```bash
npx playwright test tests/recording-persistence.spec.js
```

This test covers:
- **Save → reload → getAll** round-trip (the core goal of the plan).
- **Field completeness**: `userResponse`, `isTextMode`, `duration`, `matchedCue`, `translation` all survive the serialize/deserialize round-trip.
- **Merge-by-step**: steps restored from IDB + fresh in-memory steps appear together (the critical correctness requirement from §2.3).
- **Clear on Repeat**: `clearSpeechRecordingsForLesson` empties both IDB and in-memory.

### 4.5 — Clean up after deletions

Per `AGENTS.md` §4: after removing any export, verify all imports of that export are
removed. This plan **adds** exports to `storage.web.js` (none removed) and **adds** a new
module (`recordingDb.js`). The only external import added is in `lesson-loader.js`. No
removals → no orphaned imports to clean up. But **do run**:
```bash
npm run knip
```
to confirm no unused-export or dangling-import issues were introduced.

---

## Why Array Buffer and NOT data URLs or Blobs

| Option | Verdict | Why |
|---|---|---|
| Raw `Blob` in IDB | Rejected | Triggers WebKit `UnknownError: "Error preparing Blob/File to be stored in object store"` — the exact bug that caused the previous IDB removal (`plans/indexeddb-remove.md:5`). |
| Base64 data URL string | Rejected | 33% size overhead; async `FileReader.readAsDataURL` encode + decode round-trip; strings this large can still pressure the main thread on decode. |
| `ArrayBuffer` | **Chosen** | Structured-clone primitive — immune to the WebKit Blob bug. No base64 bloat. `blob.arrayBuffer()` is async/non-blocking on encode; `new Blob([ab], {type})` is synchronous on decode. Supported in Safari 14+. (`FileReader.readAsArrayBuffer` fallback added for very old Safari.) |

---

## Risks & Tradeoffs

- **Quota**: IndexedDB quota is typically hundreds of MB to several GB. At ~4–12MB per lesson (3×10s clips) and aggressive per-lesson cleanup (§3), this is not a concern.
- **Safari Blob bug**: Avoided — `ArrayBuffer`, not `Blob`, is what's stored.
- **Private Browsing**: Safari Private mode can fail IDB writes. The try/catch in every storage function degrades to "in-memory only for this session" — the app keeps working, recordings just don't survive reload in Private mode.
- **iOS 7-day eviction**: Safari's Intelligent Tracking Prevention clears all site storage after 7 days of inactivity. Not a concern for session-to-session recording flow; worth knowing if long-term persistence is ever expected.
- **Async everywhere**: All IDB ops are async. Verified all call sites already `await` these functions. The only fire-and-forget path is `updateSpeechRecording` in `speech-orchestrator.js` (`.catch(e => console.error(e))`); the internal try/catch logs a `console.warn` on IDB failure and never throws, so the outer `.catch` won't fire for IDB errors — acceptable.
- **Stale cross-lesson entries**: Solved by `deleteRecordsExceptLesson` on every `loadLessonContent` (§3). Recordings from past lessons become unrecoverable — this is intentional, given no cross-lesson replay.
- **Latent duplicate-segment bug**: Pre-existing — `saveSpeechRecording` keys the in-memory Map by `uffvideo_<lesson>_<step>_<timestamp>`, so re-recording a step within one session adds a second entry instead of replacing, and the planner emits one segment per recording. The merge-by-step logic in §2.3 mitigates this (latest `createdAt` per step wins in `getAll`). Aligning the Map key to per-step would fully fix it but is out of scope for this plan — leave a TODO note rather than expanding the change. The monotonic counter added in §2.1 prevents same-millisecond key collisions but does **not** fix the duplicate-segment issue (multiple entries for the same step existing at once).
- **Multi-tab behavior**: IndexedDB is shared across tabs of the same origin; the in-memory `Map` is per-JS-context (per tab). Two tabs recording the same lesson/step would have last-write-wins in IDB, and each tab's `getAll` merge would surface the other tab's persisted recordings. In practice this app is single-tab; the behavior is harmless (same lesson, one recording per step either way). Documented as a known tradeoff rather than a problem.
- **Memory on rehydration**: `getAllSpeechRecordingsForLesson` rehydrates Blobs from persisted ArrayBuffers for steps not in the in-memory Map. These Blobs are bounded by one lesson's step count (≤ ~20 steps), and the cross-lesson cleanup in §3 limits IDB to the current lesson. Worst case ~20 × 1–4MB ≈ 4–80MB of Blobs in the JS heap — within iOS Safari's per-tab memory limits for typical lessons, but worth noting on memory-constrained devices. The `arrayBuffer` field is set to `undefined` on restored records to allow GC of the raw bytes after Blob construction.

---

## Out of Scope

- Aligning the in-memory `recordingsMap` key to per-step (replace-on-save) — see latent duplicate-segment note above. Leave a `// TODO: re-record within session creates duplicate Map entries; align key to per-step` comment near `saveSpeechRecording`.
- The `storage.native.js` stub — React Native path; untouched.
- Cloud upload (R2/Cloudinary) — tracked separately in `plans/indexeddb-remove.md:175-180`; this plan is the offline-first persistence layer that upload will build on top of.

---

## Review Feedback Addressed

External review (from Claude, without codebase access) raised five points. Engagement:

1. **"Zero disk writes" claim** — Not applicable to this plan. Claude was reviewing the *old* `plans/indexeddb-remove.md` (which removed IDB). This plan *adds* IndexedDB back. No claim about zero disk writes is made anywhere in this document.

2. **Memory pressure from in-memory Map** — Same misattribution as #1: Claude was reviewing the old plan that moved recordings *out of* IDB into the Map. This plan keeps the Map (unchanged memory profile) and adds IDB *beneath* it. The only new memory is rehydrated Blobs during `getAll` for restored steps — bounded by one lesson (≤ ~20 steps × 1–4MB ≈ 4–80MB worst case). Added a risk note (§Risks) about this with the `arrayBuffer: undefined` GC mitigation.

3. **Timestamp key collision on `Date.now()`** — Valid and applicable. Pre-existing bug: two `saveSpeechRecording` calls in the same millisecond would produce identical Map keys and silently overwrite. Fixed in §2.1 by adding a monotonic `_nextRecordingSeq` counter to the Map key. Note: this prevents collisions but does **not** fix the separate duplicate-segment issue (multiple entries for the same step coexisting), which remains out of scope — the merge-by-step logic in §2.3 handles it at read time.

4. **Multi-tab/session behavior** — Valid. IndexedDB is origin-shared; the in-memory Map is per-tab. Added a risk note documenting this as a known, harmless tradeoff (same lesson, one recording per step either way).

5. **Test coverage** — Valid. Added a new Playwright test file `tests/recording-persistence.spec.js` (§4.4b) covering: save→reload→getAll round-trip, field completeness (all meta fields survive), merge-by-step (IDB steps + fresh in-memory steps together), and clear-on-Repeat.

---

## Quick Checklist for the Implementer

- [ ] `npm install idb-keyval` — confirm it appears in `package.json` + `package-lock.json`.
- [ ] Create `src/modules/storage/recordingDb.js` exactly per §1.
- [ ] Edit `src/modules/storage/storage.web.js` — add imports+helpers (§2.1), then replace all four functions (§2.2–§2.5). Keep all function signatures identical. Add success/failure logs per `AGENTS.md` §2.
- [ ] Edit `src/modules/lesson/lesson-loader.js` — add `deleteRecordsExceptLesson` import (§3.1) and the early cleanup call (§3.2).
- [ ] `npm run dev` — load `http://localhost:3000/course/model/lesson/g`, confirm no console errors.
- [ ] `npx playwright test tests/answer-flow.spec.js` — passes, no unexpected console errors/warnings.
- [ ] `npx playwright test tests/text-mode-video.spec.js` — passes (text-mode records persist with `arrayBuffer: null`).
- [ ] Create `tests/recording-persistence.spec.js` (§4.4b) — run `npx playwright test tests/recording-persistence.spec.js` — passes (reload resilience + merge-by-step).
- [ ] Manual reload test (§4.4) — recordings survive a full page reload.
- [ ] `npm run knip` — no unused exports / dangling imports introduced.
- [ ] Leave the `// TODO` comment near `saveSpeechRecording` about the latent duplicate-segment bug (out of scope note). The monotonic counter added in §2.1 prevents same-ms key collisions but multiple entries for the same step can still coexist.