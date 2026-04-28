# Report: Offline Data Synchronization to Appwrite

This report details how offline data across various client-side storage mechanisms (Local Storage, IndexedDB, and Cache) is synchronized with the backend Appwrite database.

## 1. Local Storage (Synced)

`localStorage` is the primary mechanism for saving user progress, scores, and lesson states offline. This is the **only** local data source that is actively synchronized with Appwrite.

### What is Stored:
- **Lesson Scores:** Stored under the key `lesson_scores` as a stringified JSON object.
- **Course Progress & Timestamps:** Stored under keys like `${courseId}_currentLessonId` and `${courseId}_currentLessonTimestamp`.

### Synchronization Mechanism:
All syncing to Appwrite is centralized in the `js/modules/userProfile.js` module. It relies on the `syncUserMetaData()` function, which uses the Appwrite Version 24 SDK (`tablesDB.upsertRow`) to update the user's row in the `USER_PROFILES_TABLE_ID`.

There are two primary ways Local Storage data makes its way to Appwrite:

1. **On-the-fly Syncing (`saveLessonProgress`):**
   When a user completes a lesson or updates their score, `saveLessonProgress()` first commits the changes to `localStorage` to ensure they aren't lost if the user is offline or the request fails. Immediately after, it calls `syncUserMetaData()` to persist the `course_progress`, `completed_dates` (for streak calculations), and `lesson_scores` to Appwrite.

2. **Offline Recovery Syncing (`syncOfflineScores`):**
   When the application initializes (`initializeApp` in `js/script.js`), it fetches the user's remote profile data and invokes `syncOfflineScores(State.userData)`.
   - This function reads `localStorage.getItem('lesson_scores')`.
   - It parses both the local scores and the remote scores from Appwrite.
   - It performs a merge, prioritizing local keys that do not exist remotely.
   - If missing local scores are found, it patches them into a merged object, uploads the result via `syncUserMetaData({ lesson_scores: mergedScoresStr })`, and re-saves the merged object back to `localStorage`.
   - Conversely, if local storage is empty or outdated, it seeds `localStorage` with the remote Appwrite data.

## 2. IndexedDB (Not Synced)

`IndexedDB` is used for storing heavy, unstructured media blobs (video and audio recordings from the user's microphone/camera).

### What is Stored:
- **Speech Recordings:** Stored in the `uff-media` database under the `speechRecordings` object store (managed by `js/modules/storage.js`). These include video/webm Blobs and metadata identifying the lesson and question index (`uffvideo_${lessonId}_${questionIndex}_...`).

### Synchronization Mechanism:
**None.** IndexedDB data is explicitly kept client-side and is never uploaded to Appwrite.
These blobs are retrieved locally (e.g., by `getLatestVideoFromIndexedDB` in `js/video-processing-module.js`) to process video sequences, apply canvas effects, generate thumbnails, or allow the user to download/share their recordings directly from their device.

## 3. Cache & Runtime Memory (Not Synced)

Various caches are used throughout the application to improve performance.

### What is Stored:
- **Browser Cache / Cache API:** Used by the background web worker (`js/nlp-worker.js`) via `env.useBrowserCache = true` to locally cache heavy Hugging Face NLP models (like GECToR) so they do not need to be repeatedly downloaded.
- **Runtime Maps/Memory:** Used in visual modules (like `js/video-processing-module.js`) for text metrics (`textMetricsCache`) and gradients (`cachedGradients`) to avoid expensive canvas re-calculations.

### Synchronization Mechanism:
**None.** These caches are entirely ephemeral and client-side performance optimizations. They contain no user-specific persistent states and are therefore not synced to Appwrite.

## Summary

- **Local Storage** holds textual user state (scores, streaks, progress) and is the **only data synchronized to Appwrite**, using a merge-and-upsert strategy executed on load and on update.
- **IndexedDB** holds heavy media blobs which are processed entirely on the client and are **never synchronized** to Appwrite.
- **Caches** are strictly for local asset and processing optimization and do not sync to Appwrite.
