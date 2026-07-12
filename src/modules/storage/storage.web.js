// modules/storage.web.js

import { appStore } from '../store/store.js';
import { putRecord, getRecord, listRecordsForLesson, deleteRecordsForLesson } from './recordingDb.js';

const recordingsMap = new Map();

// Monotonic counter to guarantee unique Map keys even when two
// saveSpeechRecording calls land in the same millisecond (e.g. rapid
// text-mode answers). Date.now() alone is not sufficient.
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

// ---- Public API ------------------------------------------------------------

// TODO: re-record within session creates duplicate Map entries; aligning the
// Map key to per-step (instead of per-timestamp) would fix it. The merge-by-
// step logic in getAllSpeechRecordingsForLesson mitigates at read time.

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

  // Persistence: fire-and-forget the IndexedDB write so the caller's promise
  // resolves immediately (matching the pre-IDB sync timing that the answer
  // pipeline depends on). The in-memory Map is the authoritative hot cache
  // for the current session; IDB only needs to be ready before a reload.
  console.log('[Storage] IDB save: queued fire-and-forget for', { lessonId, stepIndex, blobSize: blob?.size || 0 });
  (async () => {
    try {
      console.log('[Storage] IDB save: starting blobToArrayBuffer', { lessonId, stepIndex, blobSize: blob?.size || 0 });
      const arrayBuffer = blob ? await blobToArrayBuffer(blob) : null;
      console.log('[Storage] IDB save: blobToArrayBuffer done', { lessonId, stepIndex, arrayBufferBytes: arrayBuffer?.byteLength || 0 });
      const { blob: _omit, ...serializable } = record;
      console.log('[Storage] IDB save: calling putRecord', { lessonId, stepIndex, serializableKeys: Object.keys(serializable) });
      await putRecord(lessonId, stepIndex, { ...serializable, arrayBuffer });
      console.log('[Storage] saveSpeechRecording persisted to IndexedDB', { lessonId, stepIndex, hasBlob: !!blob });
    } catch (err) {
      // IndexedDB write failed (quota, private mode, hang timeout, etc.). The
      // in-memory entry still covers the current session — recordings will
      // just not survive a full page reload. Log and continue; do not throw.
      console.warn('[Storage] Failed to persist recording to IndexedDB', err);
    }
  })();

  return videoKey;
}

export async function getAllSpeechRecordingsForLesson(lessonId) {
  // Pure in-memory read — no IndexedDB access. This function is on the video
  // processor's critical path and must return instantly. IDB restore happens
  // once during loadLessonContent (see restoreRecordingsForLesson below).
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

  const results = Array.from(byStep.values());
  results.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  console.log('[Storage] getAllSpeechRecordingsForLesson', { lessonId, count: results.length, steps: Array.from(byStep.keys()).sort((x, y) => x - y) });
  return results;
}

/**
 * Restore persisted recordings from IndexedDB into the in-memory Map.
 * Called once during loadLessonContent, before any steps run, so that
 * getAllSpeechRecordingsForLesson can remain a pure in-memory read (instant)
 * and never block the video processor's critical path.
 *
 * In-memory entries take priority (current session is fresher). Only steps
 * that exist in IDB but NOT in the in-memory Map are restored.
 */
export async function restoreRecordingsForLesson(lessonId) {
  // Collect in-memory step indices for this lesson.
  const inMemorySteps = new Set();
  for (const record of recordingsMap.values()) {
    if (record.originalLessonId === lessonId) {
      inMemorySteps.add(record.originalStepIndex);
    }
  }

  let persisted;
  try {
    console.log('[Storage] restoreRecordingsForLesson: calling listRecordsForLesson', { lessonId, inMemoryStepCount: inMemorySteps.size });
    persisted = await listRecordsForLesson(lessonId);
    console.log('[Storage] restoreRecordingsForLesson: IDB returned', { lessonId, persistedCount: persisted.length });
  } catch (err) {
    // IndexedDB read failed (private mode, corrupted, hang, etc.). The
    // in-memory Map is still intact for the current session — recordings
    // just won't be restored from a previous session.
    console.warn('[Storage] Failed to restore recordings from IndexedDB', err);
    return;
  }

  if (persisted.length === 0) {
    console.log('[Storage] restoreRecordingsForLesson: no persisted records found — recordings will not survive reload', { lessonId });
  }

  for (const rec of persisted) {
    if (inMemorySteps.has(rec.originalStepIndex)) continue;

    const blob = rec.arrayBuffer ? arrayBufferToBlob(rec.arrayBuffer, rec.mimeType) : null;
    const restored = {
      ...rec,
      blob,
      id: rec.id || `restored_${lessonId}_${rec.originalStepIndex}`,
      arrayBuffer: undefined,
    };
    recordingsMap.set(restored.id, restored);
    console.log('[Storage] restoreRecordingsForLesson restored from IndexedDB', { lessonId, stepIndex: rec.originalStepIndex, hasBlob: !!blob });
  }
  console.log('[Storage] restoreRecordingsForLesson done', { lessonId, restoredCount: persisted.filter(r => !inMemorySteps.has(r.originalStepIndex)).length });
}

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

  // --- Persist the merged record to IndexedDB (fire-and-forget) ---
  // Same rationale as saveSpeechRecording: the in-memory Map is authoritative
  // for the current session, and callers (answer-pipeline.js,
  // speech-orchestrator.js) need this to resolve immediately so the UI
  // advances without the timing delay that triggers iPad's "Undo Typing".
  (async () => {
    try {
      console.log('[Storage] IDB update: starting getRecord', { lessonId: resolvedLessonId, stepIndex: resolvedStepIndex });
      const existing = await getRecord(resolvedLessonId, resolvedStepIndex);
      console.log('[Storage] IDB update: getRecord done', { lessonId: resolvedLessonId, stepIndex: resolvedStepIndex, hasExisting: !!existing });

      // Self-heal: if the initial save failed (existing === undefined) but the
      // in-memory record has a blob, serialize it now so the video bytes aren't
      // permanently lost from IDB.
      let arrayBuffer = existing?.arrayBuffer ?? null;
      if (!arrayBuffer && updatedRecord.blob) {
        console.log('[Storage] IDB update: self-heal — serializing blob to arrayBuffer', { lessonId: resolvedLessonId, stepIndex: resolvedStepIndex, blobSize: updatedRecord.blob.size });
        arrayBuffer = await blobToArrayBuffer(updatedRecord.blob);
      }

      const { blob: _omit, ...serializable } = updatedRecord;
      console.log('[Storage] IDB update: calling putRecord', { lessonId: resolvedLessonId, stepIndex: resolvedStepIndex, serializableKeys: Object.keys(serializable) });
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
  })();

  return latest.id;
}
