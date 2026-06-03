// modules/storage.web.js

import { appStore } from '../store/store.js';

const IDB_DB_NAME = 'uff-media';
const IDB_STORE_SPEECH = 'speechRecordings';

export function openMediaDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_SPEECH)) {
        const store = db.createObjectStore(IDB_STORE_SPEECH, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSpeechRecording(blob, meta = {}) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SPEECH, 'readwrite');
    const store = tx.objectStore(IDB_STORE_SPEECH);

    const storeState = appStore.getState();
    const lessonId = meta.lessonId ?? storeState.activeLessonId ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId ?? 'unknown_lesson';
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
      originalStepIndex: stepIndex
    };

    const req = store.put(record);
    req.onsuccess = () => resolve(videoKey);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) { } };
  });
}

export async function getAllSpeechRecordingsForLesson(lessonId) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SPEECH, 'readonly');
    const store = tx.objectStore(IDB_STORE_SPEECH);
    const request = store.getAll();

    request.onsuccess = () => {
      const allRecords = request.result || [];
      const lessonRecords = allRecords
        .filter(record =>
          record.id.startsWith(`uffvideo_${lessonId}_`) ||
          (record.originalLessonId === lessonId && record.id.startsWith('uffvideo_'))
        )
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      resolve(lessonRecords);
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) { } };
  });
}

export async function clearSpeechRecordingsForLesson(lessonId) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SPEECH, 'readwrite');
    const store = tx.objectStore(IDB_STORE_SPEECH);
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const keys = request.result || [];
      const deletePromises = keys
        .filter(key => key.startsWith(`uffvideo_${lessonId}_`))
        .map(key => new Promise((res, rej) => {
          const delReq = store.delete(key);
          delReq.onsuccess = () => res();
          delReq.onerror = () => rej(delReq.error);
        }));

      Promise.all(deletePromises)
        .then(() => resolve())
        .catch(err => reject(err));
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) { } };
  });
}

export async function updateSpeechRecording(lessonId, stepIndex, updates = {}) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SPEECH, 'readwrite');
    const store = tx.objectStore(IDB_STORE_SPEECH);

    const storeState = appStore.getState();
    const resolvedLessonId = lessonId ?? storeState.activeLessonId ?? storeState.configData?.lessons?.[storeState.currentLessonIndex]?.lessonId ?? 'unknown_lesson';
    const resolvedStepIndex = stepIndex ?? storeState.currentStepIndex ?? 0;

    const request = store.getAll();

    request.onsuccess = () => {
      const allRecords = request.result || [];
      const matchingRecords = allRecords
        .filter(record =>
          record.originalLessonId === resolvedLessonId &&
          record.originalStepIndex === resolvedStepIndex
        )
        .sort((a, b) => b.createdAt - a.createdAt);

      if (matchingRecords.length > 0) {
        const updatedRecord = { ...matchingRecords[0], ...updates };
        const putReq = store.put(updatedRecord);
        putReq.onsuccess = () => resolve(matchingRecords[0].id);
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) { } };
  });
}