import { describe, it, expect, beforeEach, vi } from 'vitest';

// The real saveLessonProgress writes to Supabase; a spy is enough to assert
// the completion contract (which lesson is counted, with what options).
vi.mock('../user/user-profile.js', () => ({
    saveLessonProgress: vi.fn(async () => ({ newDayCount: 0, newStreak: 0, lessonsCompleted: 0 })),
}));

// The friend-credit side effects (RPC + pending queue) are asserted through
// spies; their own behavior is covered in friend-credit-sync.test.js.
vi.mock('../user/friend-credit-sync.js', () => ({
    stashPendingFriendCredit: vi.fn(),
}));

vi.mock('../api/api.js', () => ({
    recordFriendCompletion: vi.fn(async () => ({ recorded: true })),
}));

import { saveLessonProgress } from '../user/user-profile.js';
import { stashPendingFriendCredit } from '../user/friend-credit-sync.js';
import { recordFriendCompletion } from '../api/api.js';
import { appStore } from '../store/store.js';
import { handleSuccessStep } from './step-loader-logic.js';

const showFeedbackAndProceed = vi.fn();

function seed(lessons, currentLessonIndex, { fromRestore = false, friendCode = null, userData = null, isLoggedIn = false } = {}) {
    appStore.setState({
        configData: { lessons },
        currentLessonIndex,
        currentStepIndex: lessons[currentLessonIndex].steps.length - 1,
        courseId: 'wouldyourather',
        userData: userData || { $id: 'user-1' },
        isLoggedIn,
        friendCode,
        stepLoadedFromRestore: fromRestore,
        recentFluencyAvgs: [],
        interactionLog: [],
        isTextMode: false,
        isCameraOff: false,
        lessonStartTime: Date.now(),
        averageWpm: 0,
        totalPauses: 0,
        totalHesitations: 0,
        recognizedIdioms: [],
        pragmaticFlags: [],
        repeatPointsHistory: [],
        rolePlayPointsHistory: [],
        fluencyScore: 100,
        appPhase: 'simpleVideo',
        completionMessage: null,
        progressPercent: '0%',
    });
}

function makeLesson(lessonId, nextLessonId) {
    return {
        lessonId,
        nextLessonId: nextLessonId || null,
        // shareCta chain shape so the friend-credit tests can use these
        // lessons as answer-side completions.
        recapOverlay: 'shareCta',
        steps: [
            { responseType: 'lessonIntro', step: 'intro' },
            { responseType: 'friendClosedResponse', step: 'q1' },
            { responseType: 'success', step: 'done' },
        ],
    };
}

function completeLesson() {
    const lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId;
    const lesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    handleSuccessStep({ ...lesson.steps[lesson.steps.length - 1], lessonId }, { total: 80 });
}

describe('handleSuccessStep persists the completed lesson', () => {
    beforeEach(() => {
        saveLessonProgress.mockClear();
        stashPendingFriendCredit.mockClear();
        recordFriendCompletion.mockClear();
        showFeedbackAndProceed.mockClear();
    });

    // The reported regression: only the nextLessonId-guarded call site counted,
    // so a terminal lesson never incremented the profile's lesson count.
    it('persists the completion of a terminal lesson (no nextLessonId) so it counts', () => {
        seed([makeLesson('a', null)], 0);

        completeLesson();

        expect(saveLessonProgress).toHaveBeenCalledTimes(1);
        const [courseId, resumeLessonId, _userData, options] = saveLessonProgress.mock.calls[0];
        expect(courseId).toBe('wouldyourather');
        // No next lesson, so the completed lesson is both the resume target and
        // the lesson that gets counted.
        expect(resumeLessonId).toBe('a');
        expect(options.incrementCount).toBe(true);
        expect(options.completedLessonId).toBe('a');
        expect(options.updateUserMeta).toBe(true);
    });

    it('counts the completed lesson, not the next-lesson target, for a chained lesson', () => {
        seed([makeLesson('m-g', 'm-a')], 0);

        completeLesson();

        const [, resumeLessonId, , options] = saveLessonProgress.mock.calls[0];
        expect(resumeLessonId).toBe('m-a');
        expect(options.completedLessonId).toBe('m-g');
        expect(options.incrementCount).toBe(true);
    });

    it('persists each completed lesson of a two-lesson course once', () => {
        const lessons = [makeLesson('a', null), makeLesson('b', null)];
        seed(lessons, 0);
        completeLesson();
        seed(lessons, 1);
        completeLesson();

        expect(saveLessonProgress).toHaveBeenCalledTimes(2);
        expect(saveLessonProgress.mock.calls.map((c) => c[3].completedLessonId)).toEqual(['a', 'b']);
        expect(saveLessonProgress.mock.calls.every((c) => c[3].incrementCount === true)).toBe(true);
    });

    // The only phantom-count guard: landing on the success step directly (page
    // load, reload, signup redirect) is not a completion. It still persists
    // the resume state, but must never ask for a count — while a genuine
    // re-traversal (Repeat, re-doing it with friends) always counts, repeats
    // included.
    it('does not request a count when the success step is landed on via restore', () => {
        seed([makeLesson('a', null)], 0, { fromRestore: true });

        completeLesson();

        expect(saveLessonProgress).toHaveBeenCalledTimes(1);
        const [courseId, resumeLessonId, , options] = saveLessonProgress.mock.calls[0];
        expect(courseId).toBe('wouldyourather');
        expect(resumeLessonId).toBe('a');
        expect(options.completedLessonId).toBe('a');
        expect(options.updateUserMeta).toBe(true);
        expect(options.incrementCount).toBe(false);
    });

    it('requests a count for a repeat traversal of the same lesson', () => {
        const lessons = [makeLesson('a', null)];
        seed(lessons, 0);
        completeLesson();
        // Repeat restores through loadLessonContent then re-traverses in-app,
        // so the success step arrives with the restore flag cleared.
        seed(lessons, 0);
        completeLesson();

        expect(saveLessonProgress).toHaveBeenCalledTimes(2);
        expect(saveLessonProgress.mock.calls.every((c) => c[3].incrementCount === true)).toBe(true);
        expect(saveLessonProgress.mock.calls.map((c) => c[3].completedLessonId)).toEqual(['a', 'a']);
    });
});

describe('handleSuccessStep credits the share-link owner', () => {
    beforeEach(() => {
        saveLessonProgress.mockClear();
        stashPendingFriendCredit.mockClear();
        recordFriendCompletion.mockClear();
    });

    // Answer side = lesson b of a shareCta chain, opened via ?shareCode=ab12.
    const answerSide = () => {
        seed([makeLesson('a', null), makeLesson('b', null)], 1, { friendCode: 'ab12' });
    };

    it('records immediately for an authenticated friend completion', () => {
        answerSide();
        appStore.setState({
            isLoggedIn: true,
            userData: { $id: 'user-1', auth_method: 'supabase', shareCode: 'xy34' },
        });

        completeLesson();

        expect(recordFriendCompletion).toHaveBeenCalledTimes(1);
        expect(recordFriendCompletion).toHaveBeenCalledWith({
            ownerShareCode: 'ab12',
            courseId: 'wouldyourather',
            lessonId: 'b',
        });
        expect(stashPendingFriendCredit).not.toHaveBeenCalled();
    });

    it('stashes a pending credit for a guest (no user id yet)', () => {
        answerSide();

        completeLesson();

        expect(recordFriendCompletion).not.toHaveBeenCalled();
        expect(stashPendingFriendCredit).toHaveBeenCalledTimes(1);
        expect(stashPendingFriendCredit).toHaveBeenCalledWith({
            ownerShareCode: 'ab12',
            courseId: 'wouldyourather',
            lessonId: 'b',
        });
    });

    it('credits nothing on a restore landing (reload / redirect)', () => {
        seed([makeLesson('a', null), makeLesson('b', null)], 1, { friendCode: 'ab12', fromRestore: true });

        completeLesson();

        expect(recordFriendCompletion).not.toHaveBeenCalled();
        expect(stashPendingFriendCredit).not.toHaveBeenCalled();
    });

    it('credits nothing without an owner share code', () => {
        seed([makeLesson('a', null), makeLesson('b', null)], 1);

        completeLesson();

        expect(recordFriendCompletion).not.toHaveBeenCalled();
        expect(stashPendingFriendCredit).not.toHaveBeenCalled();
    });

    it('credits nothing for the prompt lesson (no owner clips played)', () => {
        seed([makeLesson('a', null), makeLesson('b', null)], 0, { friendCode: 'ab12' });

        completeLesson();

        expect(recordFriendCompletion).not.toHaveBeenCalled();
        expect(stashPendingFriendCredit).not.toHaveBeenCalled();
    });

    it('credits nothing for self-completion', () => {
        answerSide();
        appStore.setState({
            isLoggedIn: true,
            userData: { $id: 'user-1', auth_method: 'supabase', shareCode: 'ab12' },
        });

        completeLesson();

        expect(recordFriendCompletion).not.toHaveBeenCalled();
        expect(stashPendingFriendCredit).not.toHaveBeenCalled();
    });
});
