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
