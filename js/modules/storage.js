// modules/storage.js

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

    // Instead of a constant key, use lessonId and questionIndex to allow multiple recordings
    let lessonId = meta.lessonId;
    if (!lessonId && typeof window !== 'undefined' && window.State && window.State.configData && window.State.configData.lessons) {
         lessonId = window.State.configData.lessons[window.State.currentLessonIndex].lessonId;
    }
    lessonId = lessonId || 'unknown_lesson';

    let questionIndex = meta.questionIndex;
    if (questionIndex === undefined) {
         // Fallback to 0 or try to get it from global State if possible
         if (typeof window !== 'undefined' && window.__currentQuestionIndex !== undefined) {
             questionIndex = window.__currentQuestionIndex;
         } else {
             questionIndex = 0;
         }
    }
    const timestamp = Date.now();
    const videoKey = `uffvideo_${lessonId}_${questionIndex}_${timestamp}`;
    
    const record = {
      id: videoKey,
      createdAt: timestamp,
      mimeType: blob ? blob.type : 'video/webm',
      size: blob ? blob.size : 0,
      blob,
      ...meta,
      originalLessonId: lessonId,
      originalQuestionIndex: questionIndex
    };
    
    const req = store.put(record); 
    req.onsuccess = () => resolve(videoKey);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) {} };
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
      // Filter records that match the lessonId and start with uffvideo
      let lessonRecords = allRecords.filter(record => {
         return record.id.startsWith(`uffvideo_${lessonId}_`) ||
                (record.originalLessonId === lessonId && record.id.startsWith('uffvideo_'));
      });

      // Sort by chronological order (createdAt)
      lessonRecords.sort((a, b) => {
        const timeA = a.createdAt !== undefined ? a.createdAt : 0;
        const timeB = b.createdAt !== undefined ? b.createdAt : 0;
        return timeA - timeB;
      });

      resolve(lessonRecords);
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) {} };
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
          const deletePromises = keys.filter(key => key.startsWith(`uffvideo_${lessonId}_`))
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
      tx.oncomplete = () => { try { db.close(); } catch (_) {} };
    });
}


export async function updateSpeechRecording(lessonId, questionIndex, updates = {}) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SPEECH, 'readwrite');
    const store = tx.objectStore(IDB_STORE_SPEECH);

    // Ensure lessonId is valid
    if (!lessonId && typeof window !== 'undefined' && window.State && window.State.configData && window.State.configData.lessons) {
        lessonId = window.State.configData.lessons[window.State.currentLessonIndex].lessonId;
    }
    lessonId = lessonId || 'unknown_lesson';

    // Ensure questionIndex is valid
    if (questionIndex === undefined) {
        if (typeof window !== 'undefined' && window.__currentQuestionIndex !== undefined) {
            questionIndex = window.__currentQuestionIndex;
        } else {
            questionIndex = 0;
        }
    }

    const request = store.getAll();

    request.onsuccess = () => {
        const allRecords = request.result || [];
        // Find all records matching lessonId and questionIndex
        const matchingRecords = allRecords.filter(record =>
            record.originalLessonId === lessonId && record.originalQuestionIndex === questionIndex
        );

        if (matchingRecords.length > 0) {
            // Sort by createdAt descending to get the latest attempt
            matchingRecords.sort((a, b) => b.createdAt - a.createdAt);
            const latestRecord = matchingRecords[0];

            const updatedRecord = { ...latestRecord, ...updates };
            const putReq = store.put(updatedRecord);
            putReq.onsuccess = () => resolve(latestRecord.id);
            putReq.onerror = () => reject(putReq.error);
        } else {
            resolve(null); // Record doesn't exist yet
        }
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { try { db.close(); } catch (_) {} };
  });
}
