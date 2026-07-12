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
