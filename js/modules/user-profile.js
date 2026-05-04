// modules/user-profile.js
// IMPORTANT! THIS SCRIPT USES VERSION 24 OF THE APPWRITE SDK, WHICH HAS MANY BREAKING CHANGES FROM EARLIER VERSIONS. DO NOT USE THE SYNTAX OR METHODS OF EARLIER VERSIONS WITHOUT CHECKING THEY ARE STILL VALID IN VERSION 24.
import { tablesDB, APPWRITE_CONFIG, getCurrentUser } from './appwrite.js';
import { invalidateUserAndAuthCache } from './api.js'; // 🚀 TanStack invalidation helper
import { localStore } from './storage-adapter.js'; // <-- Adapter for React Native compatibility

/**
 * Syncs metadata to Appwrite. 
 * Fixes the "rowId" error by ensuring we extract a string ID.
 */
export async function syncUserMetaData(metaToUpdate, providedUserData) {
    let userData = providedUserData;
    if (!userData || !userData.$id || userData.$id === 'guest') {
        userData = await getCurrentUser();
        if (!userData || !userData.$id) {
            console.warn("syncUserMetaData: Guest user, skipping sync.");
            return;
        }
    }
    const userId = userData.$id;
    try {
        await tablesDB.upsertRow({
            databaseId: APPWRITE_CONFIG.DATABASE_ID,
            tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
            rowId: userId,
            data: {
                native_language: 'EN',
                ...metaToUpdate
            },
            // Explicitly bind Row-Level Security to the user ID upon creation
            permissions: [
                `read("user:${userId}")`,
                `update("user:${userId}")`,
                `delete("user:${userId}")`
            ]
        });
        console.log("🚀 syncUserMetaData: Profile successfully upserted!");

        // 🚀 Trigger cache bust globally after any successful profile write
        invalidateUserAndAuthCache();

    } catch (error) {
        console.error("🚨 Error syncing user meta data:", error);
    }
}

/**
 * Handles initial course setup
 */
export async function saveCourseToUserProfile(courseId, userData) {
    if (!userData || userData.$id === 'guest') {
        console.warn('saveCourseToUserProfile: Guest user, skipping save.');
        return true;
    }
    try {
        let progressMap = {};
        if (userData?.course_progress) {
            try { progressMap = JSON.parse(userData.course_progress); } catch (e) { }
        }

        if (!progressMap[courseId]) {
            progressMap[courseId] = {
                current_lesson: null,
                lesson_timestamp: null
            };
            await syncUserMetaData({ course_progress: JSON.stringify(progressMap) }, userData);
        }
        return true;
    } catch (error) {
        console.error('Failed to save initial course state:', error);
        return null;
    }
}

/**
 * Restored from your original file: Handles per-lesson progress
 * Updated to use localStore adapter for React Native compatibility
 */
export async function saveLessonProgress(courseId, lessonId, userData, options = {}) {
    const timestamp = new Date().toISOString();
    const localToday = new Date().toLocaleDateString('en-CA');
    const safeOptions = options || {};
    const updateUserMetaFlag = safeOptions.updateUserMeta !== false;

    let resultState = { savedToLocal: false, streakUpdated: false, dayCountIncremented: false, newDayCount: 0, newStreak: 0 };

    try {
        localStore.setItem(`${courseId}_currentLessonId`, lessonId);
        localStore.setItem(`${courseId}_currentLessonTimestamp`, timestamp);

        if (safeOptions.scores && Array.isArray(safeOptions.scores)) {
            const baselineStr = userData?.lesson_scores || localStore.getItem('lesson_scores') || '{}';
            let localScoresMap = {};
            try { localScoresMap = JSON.parse(baselineStr); } catch (e) { }

            localScoresMap[`${courseId}_${lessonId}`] = safeOptions.scores;
            const scoresStringified = JSON.stringify(localScoresMap);
            localStore.setItem('lesson_scores', scoresStringified);
            if (userData) userData.lesson_scores = scoresStringified;
        }
        resultState.savedToLocal = true;
    } catch (e) { console.error('❌ LocalStore Error:', e); }

    if (updateUserMetaFlag && userData) {
        try {
            const metaToUpdate = { last_lesson_timestamp: timestamp };
            let progressMap = {};
            if (userData.course_progress) {
                try { progressMap = JSON.parse(userData.course_progress); } catch (e) { }
            }
            progressMap[courseId] = { current_lesson: lessonId, lesson_timestamp: timestamp };
            metaToUpdate.course_progress = JSON.stringify(progressMap);

            let dateLedger = Array.isArray(userData.completed_dates) ? userData.completed_dates : [];
            if (!dateLedger.includes(localToday)) {
                const newDateLedger = [...dateLedger, localToday];
                metaToUpdate.completed_dates = newDateLedger;
                resultState.streakUpdated = true;
                resultState.dayCountIncremented = true;
                resultState.newDayCount = newDateLedger.length;
                resultState.newStreak = calculateCurrentStreak(newDateLedger);
            } else {
                // Day already counted — return current values without incrementing
                resultState.newDayCount = dateLedger.length;
                resultState.newStreak = calculateCurrentStreak(dateLedger);
            }

            if (userData.lesson_scores) metaToUpdate.lesson_scores = userData.lesson_scores;

            await syncUserMetaData(metaToUpdate, userData);
        } catch (e) { console.error('🚨 Appwrite Sync Error:', e); }
    }
    return resultState;
}

/**
 * Restored from your original file: Calculates streaks
 */
export function calculateCurrentStreak(completedDatesArray) {
    if (!Array.isArray(completedDatesArray) || completedDatesArray.length === 0) return 0;
    const localToday = new Date().toLocaleDateString('en-CA');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const localYesterday = yesterday.toLocaleDateString('en-CA');

    if (!completedDatesArray.includes(localToday) && !completedDatesArray.includes(localYesterday)) return 0;

    let streak = 0;
    let checkDate = new Date();
    if (!completedDatesArray.includes(localToday)) checkDate.setDate(checkDate.getDate() - 1);

    while (completedDatesArray.includes(checkDate.toLocaleDateString('en-CA'))) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
}

/**
 * Restored from your original file: Handles offline score syncing
 * Updated to use localStore adapter for React Native compatibility
 */
export async function syncOfflineScores(userData) {
    if (!userData || typeof userData !== 'object' || userData.$id === 'guest') return;
    try {
        const localScoresStr = localStore.getItem('lesson_scores');
        const remoteScoresStr = userData.lesson_scores || '{}';

        if (!localScoresStr) {
            if (remoteScoresStr !== '{}') {
                localStore.setItem('lesson_scores', remoteScoresStr);
                console.log('🚀 syncOfflineScores: Seeded local storage with remote scores.');
            }
            return;
        }

        let localScoresMap = {};
        try { localScoresMap = JSON.parse(localScoresStr); } catch (e) { return; }

        let remoteScoresMap = {};
        try { remoteScoresMap = JSON.parse(remoteScoresStr); } catch (e) { }

        let needsSync = false;
        for (const key of Object.keys(localScoresMap)) {
            if (!remoteScoresMap[key]) {
                remoteScoresMap[key] = localScoresMap[key];
                needsSync = true;
            }
        }

        if (needsSync) {
            const mergedScoresStr = JSON.stringify(remoteScoresMap);
            await syncUserMetaData({ lesson_scores: mergedScoresStr }, userData);
            localStore.setItem('lesson_scores', mergedScoresStr);
        } else if (remoteScoresStr !== localScoresStr) {
            localStore.setItem('lesson_scores', remoteScoresStr);
        }
    } catch (error) { console.error('🚨 Error during offline score sync:', error); }
}