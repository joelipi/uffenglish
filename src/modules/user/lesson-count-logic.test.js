import { describe, it, expect } from 'vitest';
import { lessonCompletionKey, nextLessonCompletion, guestSignupLessonCredit } from './lesson-count-logic.js';

describe('lessonCompletionKey', () => {
    it('joins the courseId and lessonId', () => {
        expect(lessonCompletionKey('wouldyourather', 'a')).toBe('wouldyourather_a');
        expect(lessonCompletionKey('model', 'm-a')).toBe('model_m-a');
    });

    it('returns null when either part is missing', () => {
        expect(lessonCompletionKey('', 'a')).toBeNull();
        expect(lessonCompletionKey('model', '')).toBeNull();
        expect(lessonCompletionKey(null, 'a')).toBeNull();
        expect(lessonCompletionKey('model', undefined)).toBeNull();
    });
});

describe('nextLessonCompletion', () => {
    it('increments the count and records the key on a first completion', () => {
        const out = nextLessonCompletion({
            courseId: 'wouldyourather',
            lessonId: 'a',
            lessonsCompleted: 0,
            countedLessons: [],
        });

        expect(out).toEqual({
            lessonsCompleted: 1,
            countedLessons: ['wouldyourather_a'],
            key: 'wouldyourather_a',
            isFirstCompletion: true,
        });
    });

    it('counts a terminal lesson with no nextLessonId (the friend-practice a/b case)', () => {
        const prompt = nextLessonCompletion({ courseId: 'wouldyourather', lessonId: 'a', lessonsCompleted: 0 });
        const answer = nextLessonCompletion({
            courseId: 'wouldyourather',
            lessonId: 'b',
            lessonsCompleted: prompt.lessonsCompleted,
            countedLessons: prompt.countedLessons,
        });

        expect(prompt.lessonsCompleted).toBe(1);
        expect(answer.lessonsCompleted).toBe(2);
        expect(answer.countedLessons).toEqual(['wouldyourather_a', 'wouldyourather_b']);
    });

    it('counts a repeated completion again — re-doing a lesson with friends earns credit', () => {
        const first = nextLessonCompletion({
            courseId: 'model',
            lessonId: 'm-g',
            lessonsCompleted: 4,
            countedLessons: ['model_m-t'],
        });
        const repeat = nextLessonCompletion({
            courseId: 'model',
            lessonId: 'm-g',
            lessonsCompleted: first.lessonsCompleted,
            countedLessons: first.countedLessons,
        });
        const third = nextLessonCompletion({
            courseId: 'model',
            lessonId: 'm-g',
            lessonsCompleted: repeat.lessonsCompleted,
            countedLessons: repeat.countedLessons,
        });

        expect(first).toMatchObject({ lessonsCompleted: 5, isFirstCompletion: true });
        expect(repeat).toMatchObject({ lessonsCompleted: 6, isFirstCompletion: false });
        expect(third).toMatchObject({ lessonsCompleted: 7, isFirstCompletion: false });
        // The unique set never duplicates the key.
        expect(third.countedLessons).toEqual(['model_m-t', 'model_m-g']);
    });

    it('a, b, c completed earns 3 — one credit per genuine completion', () => {
        let state = { lessonsCompleted: 0, countedLessons: [] };
        for (const lessonId of ['a', 'b', 'c']) {
            state = nextLessonCompletion({ courseId: 'wouldrather', lessonId, ...state });
        }
        expect(state.lessonsCompleted).toBe(3);
        expect(state.countedLessons).toEqual(['wouldrather_a', 'wouldrather_b', 'wouldrather_c']);
    });

    it('does not mutate the input countedLessons array', () => {
        const counted = [];
        nextLessonCompletion({ courseId: 'model', lessonId: 'm-g', countedLessons: counted });
        expect(counted).toEqual([]);
    });

    it('treats a missing lessonId as no-op', () => {
        const out = nextLessonCompletion({ courseId: 'model', lessonId: null, lessonsCompleted: 7, countedLessons: [] });
        expect(out.isFirstCompletion).toBe(false);
        expect(out.lessonsCompleted).toBe(7);
    });

    it('coerces a non-numeric count to 0', () => {
        const out = nextLessonCompletion({ courseId: 'model', lessonId: 'm-g', lessonsCompleted: 'oops' });
        expect(out.lessonsCompleted).toBe(1);
    });
});

describe('guestSignupLessonCredit', () => {
    it('credits one lesson for the success screen being viewed', () => {
        expect(guestSignupLessonCredit({ courseId: 'wouldyourather', lessonId: 'a' })).toEqual({
            creditLesson: true,
            lessonsCompleted: 1,
            countedLessons: ['wouldyourather_a'],
            key: 'wouldyourather_a',
        });
    });

    it('credits a terminal lesson and a chained lesson alike', () => {
        for (const lessonId of ['a', 'b', 'm-g', 'm-a']) {
            const out = guestSignupLessonCredit({ courseId: 'c', lessonId });
            expect(out.creditLesson).toBe(true);
            expect(out.lessonsCompleted).toBe(1);
            expect(out.countedLessons).toEqual([`c_${lessonId}`]);
        }
    });

    it('credits nothing when signing up away from a success screen', () => {
        expect(guestSignupLessonCredit({ courseId: 'wouldyourather' })).toEqual({
            creditLesson: false, lessonsCompleted: 0, countedLessons: [], key: null,
        });
        expect(guestSignupLessonCredit({ lessonId: 'a' })).toEqual({
            creditLesson: false, lessonsCompleted: 0, countedLessons: [], key: null,
        });
        expect(guestSignupLessonCredit()).toEqual({
            creditLesson: false, lessonsCompleted: 0, countedLessons: [], key: null,
        });
    });
});
