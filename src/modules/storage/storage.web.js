// modules/storage.web.js

import { appStore } from '../store/store.js';

const recordingsMap = new Map();

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
