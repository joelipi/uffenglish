// modules/user-profile.js
// IMPORTANT! THIS SCRIPT USES VERSION 24 OF THE APPWRITE SDK, WHICH HAS MANY BREAKING CHANGES FROM EARLIER VERSIONS. DO NOT USE THE SYNTAX OR METHODS OF EARLIER VERSIONS WITHOUT CHECKING THEY ARE STILL VALID IN VERSION 24.
import { syncUserMetaDataMutation, getCurrentUser } from '../api/api.js';
import { appStore } from '../store/store.js';
import { nextLessonCompletion } from './lesson-count-logic.js';

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
    await syncUserMetaDataMutation(metaToUpdate, userId);
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
 * Handles per-lesson progress. All storage goes through the Zustand store (persist middleware).
 */
export async function saveLessonProgress(courseId, lessonId, userData, options = {}) {
    const timestamp = new Date().toISOString();
    const localToday = new Date().toLocaleDateString('en-CA');
    const safeOptions = options || {};

    // DO NOT save corrupted payloads
    if (safeOptions.lessonStats && safeOptions.currentLessonId) {
        if (safeOptions.lessonStats.err === 1) {
            console.warn("⚠️ Skipping telemetry save due to compression error.");
        } else {
            try {
                const baselineStr = userData?.lesson_scores || appStore.getState().lessonScores || '{}';
                let localScoresMap = {};

                try {
                    localScoresMap = JSON.parse(baselineStr);
                } catch (parseErr) {
                    console.warn("Could not parse existing lesson_scores, starting fresh.");
                }

                const lessonKey = `${courseId}_${safeOptions.currentLessonId}`;
                localScoresMap[lessonKey] = safeOptions.lessonStats;

                const scoresStringified = JSON.stringify(localScoresMap);
                appStore.getState().setLessonScores(scoresStringified);

                if (userData) {
                    userData.lesson_scores = scoresStringified;
                }
            } catch (dictionaryError) {
                console.error("🚨 Failed to append lessonStats to dictionary:", dictionaryError);
            }
        }
    }

    const updateUserMetaFlag = safeOptions.updateUserMeta !== false;

    let resultState = { savedToLocal: false, streakUpdated: false, dayCountIncremented: false, newDayCount: 0, newStreak: 0, lessonsCompleted: 0, fluencyImproving: false };

    try {
        appStore.setState({ activeLessonId: lessonId });
        appStore.getState().setCurrentLessonTimestamp(timestamp);

        if (safeOptions.scores && Array.isArray(safeOptions.scores)) {
            const baselineStr = userData?.lesson_scores || appStore.getState().lessonScores || '{}';
            let localScoresMap = {};
            try { localScoresMap = JSON.parse(baselineStr); } catch (e) { }

            localScoresMap[`${courseId}_${lessonId}`] = safeOptions.scores;
            const scoresStringified = JSON.stringify(localScoresMap);
            appStore.getState().setLessonScores(scoresStringified);
            if (userData) userData.lesson_scores = scoresStringified;
        }
        resultState.savedToLocal = true;
    } catch (e) { console.error('❌ Store Error:', e); }

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

            // Count every genuine completion — including repeats. Re-doing a
            // lesson with friends IS doing the lesson again, so it earns
            // credit again. `counted_lessons` stays the UNIQUE set of completed
            // lessons (the unique count is its length); the fluency running
            // average still admits only each lesson's first completion.
            // The counted lesson is the COMPLETED lesson — NOT the next-lesson
            // target — so a lesson with no `nextLessonId` (every friend-practice
            // lesson, e.g. wouldyourather a/b) still counts.
            const completedLessonId = safeOptions.completedLessonId || safeOptions.currentLessonId || null;
            if (safeOptions.incrementCount === true && completedLessonId) {
                const baselineCounted = [
                    ...(Array.isArray(userData.counted_lessons) ? userData.counted_lessons : []),
                    ...(Array.isArray(appStore.getState().countedLessons) ? appStore.getState().countedLessons : []),
                ];
                const completion = nextLessonCompletion({
                    courseId,
                    lessonId: completedLessonId,
                    // The store seeds from the profile and is updated in-session,
                    // so it catches a stale `userData` between two completions.
                    lessonsCompleted: Math.max(
                        Number(userData.lessons_completed || 0),
                        Number(appStore.getState().lessonsCompleted || 0)
                    ),
                    countedLessons: baselineCounted,
                });
                resultState.lessonsCompleted = completion.lessonsCompleted;
                metaToUpdate.lessons_completed = completion.lessonsCompleted;
                metaToUpdate.counted_lessons = completion.countedLessons;
                // Keep the in-session baseline in sync so the next completion
                // increments instead of re-writing the same number.
                userData.lessons_completed = completion.lessonsCompleted;
                userData.counted_lessons = completion.countedLessons;
                appStore.getState().setLessonsCompleted(completion.lessonsCompleted);
                appStore.getState().setCountedLessons(completion.countedLessons);
                console.log(`[Gamification] Lesson completed. Total lessons: ${completion.lessonsCompleted}`);

                if (completion.isFirstCompletion) {
                    // Fluency running averages (first completion of each lesson).
                    const currentSum = Number(userData.total_fluency_sum || 0);
                    const lessonAvg = safeOptions.lessonAverage || 0;
                    const newSum = currentSum + lessonAvg;
                    metaToUpdate.total_fluency_sum = newSum;
                    const recent = Array.isArray(userData.recent_fluency_avgs) ? [...userData.recent_fluency_avgs] : [];
                    recent.push(lessonAvg);
                    if (recent.length > 10) recent.shift();
                    metaToUpdate.recent_fluency_avgs = recent;
                    console.log(`[Gamification] Fluency avg updated. Sum: ${newSum}, Recent count: ${recent.length}`);
                } else {
                    console.log(`[Gamification] Repeat completion of ${completion.key} counted for lesson total (fluency avg keeps first completion only)`);
                }
            }

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
 * Handles offline score syncing. All storage goes through the Zustand store (persist middleware).
 */
export async function syncOfflineScores(userData) {
    if (!userData || typeof userData !== 'object' || userData.$id === 'guest') return;
    try {
        const localScoresStr = appStore.getState().lessonScores;
        const remoteScoresStr = userData.lesson_scores || '{}';

        if (!localScoresStr || localScoresStr === '{}') {
            if (remoteScoresStr !== '{}') {
                appStore.getState().setLessonScores(remoteScoresStr);
                console.log('🚀 syncOfflineScores: Seeded local store with remote scores.');
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
            appStore.getState().setLessonScores(mergedScoresStr);
        } else if (remoteScoresStr !== localScoresStr) {
            appStore.getState().setLessonScores(remoteScoresStr);
        }
    } catch (error) { console.error('🚨 Error during offline score sync:', error); }
}