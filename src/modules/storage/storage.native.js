// modules/storage.native.js
// React Native stub — matches storage.web.js interface.

export async function openMediaDB() {
    console.warn('[storage.native] openMediaDB not yet implemented');
    return null;
}

export async function saveSpeechRecording(blob, meta = {}) {
    console.warn('[storage.native] saveSpeechRecording not yet implemented');
    return null;
}

export async function getAllSpeechRecordingsForLesson(lessonId) {
    console.warn('[storage.native] getAllSpeechRecordingsForLesson not yet implemented');
    return [];
}

export async function clearSpeechRecordingsForLesson(lessonId) {
    console.warn('[storage.native] clearSpeechRecordingsForLesson not yet implemented');
}

export async function updateSpeechRecording(lessonId, stepIndex, updates = {}) {
    console.warn('[storage.native] updateSpeechRecording not yet implemented');
    return null;
}

export function clearInMemoryRecordingsForLesson(lessonId) {
    console.warn('[storage.native] clearInMemoryRecordingsForLesson not yet implemented');
}

export async function restoreRecordingsForLesson(lessonId) {
    console.warn('[storage.native] restoreRecordingsForLesson not yet implemented');
}
