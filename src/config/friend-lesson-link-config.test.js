import { describe, it, expect } from 'vitest';
import friend from './friend.json';
import model from './model.json';
import gt2 from './gt2.json';

// The friend-challenge answer-lesson link uses a fixed, deterministic mapping:
// ask lesson 'a' -> answer lesson 'b' in the same course. These tests lock the
// premise on the real configs: the feature is live only where lesson 'b' exists,
// and every course with lesson 'a' but no 'b' must be suppressed by the guard.

function lessonIds(config) {
    return config.lessons.map((l) => l.lessonId);
}

describe('fixed a -> b mapping premise', () => {
    it('friend.json has both lesson a and lesson b (link is live)', () => {
        const ids = lessonIds(friend);
        expect(ids).toContain('a');
        expect(ids).toContain('b');
    });

    it('model.json has lesson a but no lesson b (guard suppresses)', () => {
        const ids = lessonIds(model);
        expect(ids).toContain('a');
        expect(ids).not.toContain('b');
    });

    it('gt2.json has lesson a but no lesson b (guard suppresses)', () => {
        const ids = lessonIds(gt2);
        expect(ids).toContain('a');
        expect(ids).not.toContain('b');
    });
});

describe('friend.json lesson b embeds the ask questions', () => {
    const b = friend.lessons.find((l) => l.lessonId === 'b');
    const askSteps = b.steps.filter((s) => s.publishLessonId === 'a');

    it('has exactly 3 embedded ask recording steps, all publishing under lesson a', () => {
        expect(askSteps).toHaveLength(3);
        for (const step of askSteps) {
            expect(step.responseType).toBe('friendClosedResponse');
            // Embedded ask prompts are system prompts, never friend-response slugs,
            // so the recapSources: 'friend' invariant still holds for lesson b.
            expect(step.simpleVideoUrl).not.toMatch(/-response-\d+/);
        }
    });

    it('keeps the three friend-answer steps intact', () => {
        const answerSlugs = b.steps
            .map((s) => s.simpleVideoUrl)
            .filter((u) => typeof u === 'string' && u.startsWith('{friendCode}'));
        expect(answerSlugs).toEqual([
            '{friendCode}friend-a-response-01',
            '{friendCode}friend-a-response-02',
            '{friendCode}friend-a-response-03',
        ]);
    });

    it('tags no step outside lesson b with publishLessonId', () => {
        const taggedLessons = friend.lessons.flatMap((l) =>
            l.steps.filter((s) => s.publishLessonId !== undefined).map(() => l.lessonId)
        );
        expect([...new Set(taggedLessons)]).toEqual(['b']);
    });
});
