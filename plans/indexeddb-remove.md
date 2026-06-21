# Replace IndexedDB with In-Memory Map for Speech Recordings

## Why

- **iOS Safari crash**: IndexedDB throws `UnknownError: "Error preparing Blob/File to be stored in object store"` when storing video Blobs. This is a WebKit bug with no workaround other than avoiding Blob storage in IndexedDB on iOS.
- **No disk persistence desired**: Recordings should not occupy the user's device storage beyond the current session. In-memory storage guarantees zero disk writes and zero disk accumulation.
- **No behavior change**: `clearSpeechRecordingsForLesson` is called on every `loadLessonContent` (`lesson-loader.js:10`), so IndexedDB already provides no page-reload resilience. The in-memory Map matches the existing durability contract exactly.

---

## 1. File Modified

**`src/modules/storage/storage.web.js`** — full rewrite. All four exported functions keep the same signatures.

### Removed

- `IDB_DB_NAME`, `IDB_STORE_SPEECH` constants
- `openMediaDB()` — no external callers (verified via `grep`)
- All `indexedDB.open`, `db.transaction`, `objectStore`, `req.onsuccess/onerror`, `Promise` wrapping

### Added

A single module-scoped `Map`:

```js
const recordingsMap = new Map();
```

---

## 2. Exported Functions

### `saveSpeechRecording(blob, meta = {})`

Generate key from lesson/step/timestamp and store the record directly (blob stays as-is — no `arrayBuffer()` conversion needed since we avoid IndexedDB entirely).

```js
export async function saveSpeechRecording(blob, meta = {}) {
  const storeState = appStore.getState();
  const lessonId = meta.lessonId
    ?? storeState.activeLessonId
    ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId
    ?? 'unknown_lesson';
  const stepIndex = meta.stepIndex ?? storeState.currentStepIndex ?? 0;
  const timestamp = Date.now();
  const videoKey = `uffvideo_${lessonId}_${stepIndex}_${timestamp}`;

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

  recordingsMap.set(videoKey, record);
  return videoKey;
}
```

---

### `getAllSpeechRecordingsForLesson(lessonId)`

Filter by `originalLessonId` (the canonical field set by `saveSpeechRecording` — no key-string parsing needed) and sort ascending.

```js
export async function getAllSpeechRecordingsForLesson(lessonId) {
  const results = [];
  for (const [, record] of recordingsMap) {
    if (record.originalLessonId === lessonId) {
      results.push(record);
    }
  }
  results.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return results;
}
```

**Caller:** `video-processor.web.js:90` — receives `record.blob` as a native `Blob` ready for `URL.createObjectURL`.

---

### `clearSpeechRecordingsForLesson(lessonId)`

Collect matching keys first, then delete. Avoids mutation-during-iteration confusion.

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
}
```

**Caller:** `lesson-loader.js:10` — called on every lesson load. Also serves as the implicit memory ceiling: recordings from the previous lesson are cleared before the next one begins.

---

### `updateSpeechRecording(lessonId, stepIndex, updates = {})`

Find the most recent record matching lesson+step, merge updates, store back. Warns if no record is found (so missing analytics don't go unnoticed).

```js
export async function updateSpeechRecording(lessonId, stepIndex, updates = {}) {
  const storeState = appStore.getState();
  const resolvedLessonId = lessonId
    ?? storeState.activeLessonId
    ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId
    ?? 'unknown_lesson';
  const resolvedStepIndex = stepIndex ?? storeState.currentStepIndex ?? 0;

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
  return latest.id;
}
```

**Callers:**
- `speech-orchestrator.js:45,62,108` — saves transcript metadata after speech detection
- `answer-pipeline.js:535,606` — saves response text and analytics

---

## 3. Files NOT Changed

| File | Reason |
|---|---|
| `src/modules/storage/storage.js` | Re-exports via `export *` — no changes needed |
| `src/modules/storage/storage.native.js` | Separate native stub, untouched |
| `src/modules/speech/speech.web.js` | Imports `saveSpeechRecording` — unchanged signature |
| `src/modules/speech/speech-orchestrator.js` | Calls same functions with same args |
| `src/modules/answer/answer-pipeline.js` | Calls `updateSpeechRecording` with same args |
| `src/modules/video/video-processor.web.js` | Calls `getAllSpeechRecordingsForLesson` — expects same return shape |
| `src/modules/lesson/lesson-loader.js` | Calls `clearSpeechRecordingsForLesson` with same args |
| `tests/answer-flow.spec.js` | No storage-specific tests exist |

---

## 4. Design Notes

- **Map mutation during iteration**: `clearSpeechRecordingsForLesson` collects keys into a separate array before deleting. While JS allows `Map.delete()` during `for...of`, this is less prone to confusion.
- **Filter simplification**: `getAllSpeechRecordingsForLesson` and `clearSpeechRecordingsForLesson` filter by `record.originalLessonId` rather than key-string prefix. This field is always set by `saveSpeechRecording`, making the filter both simpler and more intention-revealing.
- **Memory ceiling**: `clearSpeechRecordingsForLesson` runs on every lesson load, bounding the Map to at most one lesson's recordings at a time. No explicit ceiling needed.
- **Null return warning**: `updateSpeechRecording` logs a warning when no matching record is found, aiding debugging if metadata updates silently fail.
- **No storage tests exist** — no test updates required.

---

## 5. Future Compatibility

When cloud upload is added (TanStack Query → R2/Cloudinary):

1. At lesson end, `getAllSpeechRecordingsForLesson` returns all blobs still in memory
2. TanStack Query mutation uploads each blob
3. Cloud URL replaces the blob as the durable record
4. No IndexedDB read step needed — cleaner data flow

No code changes from this plan need to be undone.
