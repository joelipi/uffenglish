// modules/user-profile.js
// IMPORTANT! THIS SCRIPT USES VERSION 24 OF THE APPWRITE SDK, WHICH HAS MANY BREAKING CHANGES FROM EARLIER VERSIONS. DO NOT USE THE SYNTAX OR METHODS OF EARLIER VERSIONS WITHOUT CHECKING THEY ARE STILL VALID IN VERSION 24.
import { syncUserMetaDataMutation, getCurrentUser, fetchProfileIdentityRow, recordLessonCompletion } from '../api/api.js';
import { appStore } from '../store/store.js';
import { profileIsIncomplete, planProfileRepair } from './profile-repair-logic.js';
import { mintShareCode } from '../utils/share-code-mint.js';
import { calculateCurrentStreak } from './streak-logic.js';

/**
 * Fold a freshly written profile payload into the store's copy of the user, so
 * the rest of this session sees the share code the repair just generated.
 * Share links read `userData.shareCode`, and the bootstrap only seeds the store
 * once (its `initStarted` guard), so without this a repaired account would emit
 * `undefined` in share URLs and R2 keys until a full page reload.
 */
function mergeRepairedProfileIntoStore(payload) {
    const current = appStore.getState().userData;
    if (!current || current.$id !== payload.id) return;
    appStore.getState().setCourseData({
        userData: {
            ...current,
            ...(payload.email && { email: payload.email }),
            ...(payload.share_code && { share_code: payload.share_code, shareCode: payload.share_code }),
            ...(payload.join_date && { join_date: payload.join_date }),
            ...(payload.account_status && { account_status: payload.account_status }),
        },
    });
}

/**
 * Repair a profile row that is missing or incomplete, instead of writing a
 * fragment into it.
 *
 * Every write to `user_profiles` is an upsert, which PostgREST resolves to a
 * bare INSERT when no row exists — so writing only `course_progress` against an
 * account with no profile CREATED one with a NULL email and no share code. That
 * is how the ghost rows in the database were produced.
 *
 * This NEVER destroys data. It fills only fields that are absent, never rotates
 * an existing share code (links are already published to R2 and printed), and
 * never invents an english level (that would overwrite a real answer).
 * profile-repair-logic.js owns those rules as pure functions.
 *
 * Detection uses an explicit `maybeSingle()` read rather than the shape of the
 * object handed in: `useUserProfile` returns its core-data fallback both when the
 * row is missing AND when the read fails, so inferring from that object would
 * repair a healthy profile on every transient network error. The read is skipped
 * when the object POSITIVELY shows a complete row — a signal the fallback can
 * never produce — which keeps the common case off the network entirely, since
 * this runs ahead of the preloader on every course boot.
 *
 * Returns `{ confirmed, payload }`. `confirmed` is the single source of truth for
 * "the row exists" and is false only when we genuinely cannot tell; `payload` is
 * what was written, or null. A status rather than a bare value matters: an
 * earlier version returned null for four different outcomes and the caller then
 * re-derived the answer from the very object this read exists to distrust.
 */
export async function ensureCompleteProfileRow(userData) {
    const userId = userData?.$id;
    if (!userId || userId === 'guest') return { confirmed: false, payload: null, reason: 'guest' };

    // Fast path: a positive complete signal, which the core-data fallback can
    // never produce. The safety rests on an INVARIANT about the producers, not
    // on profileIsIncomplete itself (which is merely "not provably incomplete"
    // for anything that is not a row):
    //   - useUserProfile's core-data fallback carries email + join_date but
    //     NEVER share_code or account_status;
    //   - the guest object is rejected above by its $id;
    //   - mergeRepairedProfileIntoStore only adds these after a real write.
    // So nothing can look complete unless a row (or a repair of one) supplied
    // it. Do not add these keys to a fallback object — that would make this fast
    // path confirm a row no write ever created.
    if (!profileIsIncomplete(userData)) return { confirmed: true, payload: null };

    const { row, error } = await fetchProfileIdentityRow(userId);
    // A failed read is not evidence of a missing row: do nothing, do not guess.
    if (error) {
        console.warn('[user-profile] Profile read failed — skipping repair:', error?.message || error);
        return { confirmed: false, payload: null, reason: 'read-failed' };
    }
    if (row && !profileIsIncomplete(row)) {
        // Confirmed complete, but the object handed in was the core-data
        // fallback (its own query failed at a different moment), so this session
        // still does not know the share code. Merge it rather than leave share
        // links emitting undefined until the next reload.
        mergeRepairedProfileIntoStore({
            id: row.id || userId,
            ...(row.share_code && { share_code: row.share_code }),
            ...(row.join_date && { join_date: row.join_date }),
            ...(row.account_status && { account_status: row.account_status }),
        });
        return { confirmed: true, payload: null };
    }

    const user = await getCurrentUser();
    if (!user || !user.$id || user.$id === 'guest') {
        return { confirmed: false, payload: null, reason: 'no-session' };
    }
    // The id to repair came from userData, while the email/name/timestamp used to
    // fill it come from this later session read. If the session changed
    // underneath us, filling one account's row from another would write a user's
    // address onto someone else's profile.
    if (user.$id !== userId) {
        return { confirmed: false, payload: null, reason: 'session-mismatch' };
    }

    // A candidate share code is generated up front and usually discarded:
    // the plan includes it only when the row has none to protect. Mint it on
    // the server (reserved-word + uniqueness checked); if the RPC is
    // unreachable, fall back to the reserved-filtered local generator.
    const needsShareCode = !row || !row.share_code;
    const candidateShareCode = needsShareCode ? await mintShareCode() : null;

    const plan = planProfileRepair({ row, user, shareCode: candidateShareCode });
    if (plan.action === 'none') return { confirmed: true, payload: null };

    await syncUserMetaDataMutation(plan.payload, userId);
    console.log(
        `${plan.action === 'insert' ? 'Created' : 'Repaired'} profile row for ${userId}`
        + ` (${Object.keys(plan.payload).length - 1} field(s))`,
    );
    mergeRepairedProfileIntoStore(plan.payload);
    return { confirmed: true, payload: plan.payload };
}

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
        // Repair BEFORE writing progress. Without this the write below upserts
        // `course_progress` alone, which fabricates a NULL-email row for any
        // account whose profile is missing — the exact ghost row this exists to
        // prevent. `confirmed` is the single source of truth for "the row exists":
        // if we cannot establish that, the progress write is exactly the write
        // that would deepen a fragment, so we stop instead.
        let outcome;
        try {
            outcome = await ensureCompleteProfileRow(userData);
        } catch (repairError) {
            console.error('[user-profile] Profile repair failed — skipping progress write:', repairError);
            return null;
        }
        if (!outcome.confirmed) {
            console.warn('[user-profile] Profile row unconfirmed — skipping progress write.');
            return null;
        }

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

    // The COUNTERS — lessons_completed, counted_lessons, completed_dates — are
    // written by a server-side RPC keyed on the SESSION (auth.uid()), so they
    // land even when the store has no profile copy yet. The client used to add
    // one to a baseline it read from a store copy and write the whole thing
    // back with an upsert: a write that can be lost SILENTLY (a zero-row
    // upsert is not an error in PostgREST) and that is skipped entirely when
    // the store copy is missing. A learner who finished a lesson then saw
    // their own public profile say they had completed nothing.
    //
    // The counted lesson is the COMPLETED lesson — NOT the next-lesson target
    // — so a lesson with no `nextLessonId` (every friend-practice lesson, e.g.
    // wouldyourather a/b) still counts. Only a genuine completion counts
    // (`incrementCount`): landing on the success step directly (a page load, a
    // reload, a signup redirect) is a phantom, never a completion.
    const completedLessonId = safeOptions.completedLessonId || safeOptions.currentLessonId || null;
    let completion = null;
    if (safeOptions.incrementCount === true && completedLessonId) {
        completion = await recordLessonCompletion({ courseId, completedLessonId });
        if (completion) {
            resultState.lessonsCompleted = completion.lessonsCompleted;
            resultState.countedLessons = completion.countedLessons;
            // Keep the in-session mirrors in sync so the next completion counts
            // from the same baseline the server just wrote.
            if (userData) {
                userData.lessons_completed = completion.lessonsCompleted;
                userData.counted_lessons = completion.countedLessons;
                userData.completed_dates = completion.completedDates;
            }
            appStore.getState().setLessonsCompleted(completion.lessonsCompleted);
            appStore.getState().setCountedLessons(completion.countedLessons);
            // The completion day counts too: without it the profile would show
            // streak 0 / 0 active days despite just finishing a lesson.
            resultState.streakUpdated = true;
            resultState.dayCountIncremented = completion.dayAdded === true;
            resultState.newDayCount = completion.completedDates.length;
            resultState.newStreak = calculateCurrentStreak(completion.completedDates);
        } else {
            console.warn('[user-profile] Lesson completion could not be recorded (the profile counters are unchanged)');
        }
    }

    if (updateUserMetaFlag && userData) {
        try {
            const metaToUpdate = { last_lesson_timestamp: timestamp };
            let progressMap = {};
            if (userData.course_progress) {
                try { progressMap = JSON.parse(userData.course_progress); } catch (e) { }
            }
            progressMap[courseId] = { current_lesson: lessonId, lesson_timestamp: timestamp };
            metaToUpdate.course_progress = JSON.stringify(progressMap);

            if (userData.lesson_scores) metaToUpdate.lesson_scores = userData.lesson_scores;

            // The fluency running average admits only each lesson's FIRST
            // completion, so it is derived from the same server-side answer.
            const lessonAvg = safeOptions.lessonAverage || 0;
            if (completion && completion.isFirstCompletion && userData) {
                const currentSum = Number(userData.total_fluency_sum || 0);
                const newSum = currentSum + lessonAvg;
                metaToUpdate.total_fluency_sum = newSum;
                const recent = Array.isArray(userData.recent_fluency_avgs) ? [...userData.recent_fluency_avgs] : [];
                recent.push(lessonAvg);
                if (recent.length > 10) recent.shift();
                metaToUpdate.recent_fluency_avgs = recent;
                userData.total_fluency_sum = newSum;
                userData.recent_fluency_avgs = recent;
                console.log(`[Gamification] Fluency avg updated. Sum: ${newSum}, Recent count: ${recent.length}`);
            }

            await syncUserMetaData(metaToUpdate, userData);
        } catch (e) { console.error('🚨 Appwrite Sync Error:', e); }
    }
    return resultState;
}

// The streak arithmetic lives in the pure `streak-logic.js` module (so the
// statistics modules do not import this file's API client and store). It is
// re-exported here for the existing callers: the bootstrap wiring, the signup
// credit and this module's own completion bookkeeping.
export { calculateCurrentStreak };

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