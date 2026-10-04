import { describe, it, expect } from 'vitest';
import friend from './friend.json';
import model from './model.json';
import gt2 from './gt2.json';
import wouldrather from './wouldrather.json';
import friendchain from './friendchain.json';
import { nextFriendLessonId } from '../modules/user/friend-lesson-link-logic.js';

// The friend-challenge chain is the sequence of `recapOverlay: "shareCta"`
// lessons in config order. These tests lock the premise on the real configs:
// the link after a lesson exists only where a later shareCta lesson follows.

function lessonIds(config) {
    return config.lessons.map((l) => l.lessonId);
}

describe('shareCta-order chain premise', () => {
    it('friend.json chains a -> b -> (null): b is the last shareCta lesson', () => {
        expect(lessonIds(friend)).toContain('a');
        expect(lessonIds(friend)).toContain('b');
        expect(nextFriendLessonId(friend, 'a')).toBe('b');
        expect(nextFriendLessonId(friend, 'b')).toBeNull();
    });

    it('wouldrather.json chains a -> b -> (null)', () => {
        expect(nextFriendLessonId(wouldrather, 'a')).toBe('b');
        expect(nextFriendLessonId(wouldrather, 'b')).toBeNull();
    });

    it('friendchain.json chains a -> b -> ... -> h -> (null)', () => {
        expect(nextFriendLessonId(friendchain, 'a')).toBe('b');
        expect(nextFriendLessonId(friendchain, 'b')).toBe('c');
        expect(nextFriendLessonId(friendchain, 'g')).toBe('h');
        expect(nextFriendLessonId(friendchain, 'h')).toBeNull();
    });

    it('a config with no shareCta lessons yields no next', () => {
        expect(nextFriendLessonId(model, 'm-w')).toBe('wa');
        // gt2 has no shareCta lessons at all.
        expect(nextFriendLessonId(gt2, 'g-a')).toBeNull();
    });

    it('model.json has no single-letter friend lesson ids', () => {
        const ids = lessonIds(model);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');
    });

    it('gt2.json has no single-letter friend lesson ids', () => {
        const ids = lessonIds(gt2);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');
    });
});

describe('model.json shareCta lessons chain in config order', () => {
    it('orders w -> wa -> wf -> wfa', () => {
        // model.json contains four shareCta lessons; the generic rule orders
        // them by their position in configData.lessons.
        expect(nextFriendLessonId(model, 'm-w')).toBe('wa');
        expect(nextFriendLessonId(model, 'wa')).toBe('wf');
        expect(nextFriendLessonId(model, 'wf')).toBe('wfa');
        expect(nextFriendLessonId(model, 'wfa')).toBeNull();
    });
});
