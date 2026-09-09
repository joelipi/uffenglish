// src/modules/storage/recordingDb.js
// IndexedDB-backed persistence for speech recordings via idb-keyval.
// Stores one record per (lessonId, stepIndex). Values are plain objects
// containing an `arrayBuffer` (for webcam recordings) or `arrayBuffer: null`
// (for text-mode recordings) — never a raw Blob, which triggers the WebKit
// "Error preparing Blob/File to be stored in object store" bug.

import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'recording:';
const keyFor = (lessonId, stepIndex) => `${PREFIX}${lessonId}:${stepIndex}`;

// --- Timeout wrapper --------------------------------------------------------
// iPad Safari IDB transactions can hang silently (never resolve or reject).
// This wrapper converts a silent hang into a visible rejection so callers'
// catch blocks can handle it gracefully instead of waiting forever.
function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[IDB] TIMEOUT: ${label} (${ms}ms)`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const IDB_TIMEOUT_MS = 8000;

// Custom store promise tracking — verifies IDB actually works on this browser
// at module load time. The health check is fire-and-forget; its result is
// logged to the console (visible in eruda on mobile) but never blocks.
let _idbHealthy = null;

function runHealthCheck() {
    const testKey = '__idb_health_check__';
    const testVal = { ok: true, ts: Date.now() };
    withTimeout(set(testKey, testVal), IDB_TIMEOUT_MS, 'health-check set')
        .then(() => withTimeout(get(testKey), IDB_TIMEOUT_MS, 'health-check get'))
        .then((result) => {
            if (result && result.ok) {
                _idbHealthy = true;
                console.log('[IDB] Health check: OK');
            } else {
                _idbHealthy = false;
                console.error('[IDB] Health check: FAILED — get returned unexpected value', result);
            }
            return withTimeout(del(testKey), IDB_TIMEOUT_MS, 'health-check del');
        })
        .catch((err) => {
            _idbHealthy = false;
            console.error('[IDB] Health check: FAILED', err.message || err);
        });
}

// Run the health check as soon as this module is imported (only if IndexedDB
// is available — jsdom and some test environments lack it).
if (typeof indexedDB !== 'undefined') {
    runHealthCheck();
}

/**
 * Persist (or overwrite) a recording record for a given lesson + step.
 * The record must be structured-cloneable: the video payload lives under
 * `record.arrayBuffer` (an ArrayBuffer or null), never a Blob.
 */
export async function putRecord(lessonId, stepIndex, record) {
    return withTimeout(set(keyFor(lessonId, stepIndex), record), IDB_TIMEOUT_MS, `putRecord(${lessonId}:${stepIndex})`);
}

/**
 * Read a single recording record. Returns `undefined` if not found.
 */
export async function getRecord(lessonId, stepIndex) {
    return withTimeout(get(keyFor(lessonId, stepIndex)), IDB_TIMEOUT_MS, `getRecord(${lessonId}:${stepIndex})`);
}

/**
 * Return all persisted recording records for a lesson, as an array.
 * Deterministic order is NOT guaranteed here — the caller sorts.
 */
export async function listRecordsForLesson(lessonId) {
    const allKeys = await withTimeout(keys(), IDB_TIMEOUT_MS, 'listRecordsForLesson: keys()');
    const prefix = `${PREFIX}${lessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(prefix)
    );
    console.log('[IDB] listRecordsForLesson', { lessonId, totalKeys: allKeys.length, matchingKeys: matchingKeys.length });
    if (matchingKeys.length === 0) return [];
    const records = await Promise.all(
        matchingKeys.map((k) => withTimeout(get(k), IDB_TIMEOUT_MS, `listRecordsForLesson: get(${k})`))
    );
    return records.filter(Boolean);
}

/**
 * Delete all persisted recording records for a lesson.
 */
export async function deleteRecordsForLesson(lessonId) {
    const allKeys = await withTimeout(keys(), IDB_TIMEOUT_MS, 'deleteRecordsForLesson: keys()');
    const prefix = `${PREFIX}${lessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(prefix)
    );
    if (matchingKeys.length === 0) return;
    await Promise.all(
        matchingKeys.map((k) => withTimeout(del(k), IDB_TIMEOUT_MS, `deleteRecordsForLesson: del(${k})`))
    );
}

/**
 * Delete all persisted recording records for every lesson EXCEPT the one
 * named by `keepLessonId`. Called on lesson load to bound IDB growth —
 * there is no cross-lesson replay, so old lessons' recordings are
 * unrecoverable by design.
 */
export async function deleteRecordsExceptLesson(keepLessonId) {
    const allKeys = await withTimeout(keys(), IDB_TIMEOUT_MS, 'deleteRecordsExceptLesson: keys()');
    const keepPrefix = `${PREFIX}${keepLessonId}:`;
    const matchingKeys = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(PREFIX) && !k.startsWith(keepPrefix)
    );
    console.log('[IDB] deleteRecordsExceptLesson', { keepLessonId, totalKeys: allKeys.length, deletingKeys: matchingKeys.length });
    if (matchingKeys.length === 0) return;
    await Promise.all(
        matchingKeys.map((k) => withTimeout(del(k), IDB_TIMEOUT_MS, `deleteRecordsExceptLesson: del(${k})`))
    );
}