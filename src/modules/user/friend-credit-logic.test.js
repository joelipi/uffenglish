import { describe, it, expect } from 'vitest';
import friendchainConfig from '../../config/friendchain.json';
import { isAnswerSideFriendLesson, resolveFriendCredit, pendingCreditKey, appendPendingCredit } from './friend-credit-logic.js';

const base = {
    configData: friendchainConfig,
    courseId: 'friendchain',
    ownerShareCode: 'Ab12CD',
    actorShareCode: 'xY34zZ',
    completedInApp: true,
};

describe('isAnswerSideFriendLesson', () => {
    it('is false for the prompt (first) lesson, which plays none of the owner clips', () => {
        expect(isAnswerSideFriendLesson({ configData: friendchainConfig, lessonId: 'a' })).toBe(false);
    });

    it('is true for chain lessons after the first', () => {
        for (const lessonId of ['b', 'c', 'h']) {
            expect(isAnswerSideFriendLesson({ configData: friendchainConfig, lessonId })).toBe(true);
        }
    });

    it('is false for unknown lessons and missing configs', () => {
        expect(isAnswerSideFriendLesson({ configData: friendchainConfig, lessonId: 'zzz' })).toBe(false);
        expect(isAnswerSideFriendLesson({ configData: null, lessonId: 'b' })).toBe(false);
        expect(isAnswerSideFriendLesson()).toBe(false);
    });
});

describe('resolveFriendCredit', () => {
    it('returns the owner payload for an in-app answer-side completion', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b' })).toEqual({
            ownerShareCode: 'ab12cd',
            courseId: 'friendchain',
            lessonId: 'b',
        });
    });

    it('returns null for a phantom landing (reload / redirect, not a completion)', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b', completedInApp: false })).toBeNull();
    });

    it('returns null for the prompt lesson (no owner clips played)', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'a' })).toBeNull();
    });

    it('returns null without an owner share code', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b', ownerShareCode: '  ' })).toBeNull();
        expect(resolveFriendCredit({ ...base, lessonId: 'b', ownerShareCode: null })).toBeNull();
    });

    it('returns null for self-completion (owner answering their own link)', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b', actorShareCode: 'AB12cd' })).toBeNull();
    });

    it('allows a guest completion through (no actor code yet — deferred to signup)', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b', actorShareCode: null })).toEqual({
            ownerShareCode: 'ab12cd',
            courseId: 'friendchain',
            lessonId: 'b',
        });
    });

    it('returns null without a course or lesson', () => {
        expect(resolveFriendCredit({ ...base, lessonId: 'b', courseId: '' })).toBeNull();
        expect(resolveFriendCredit({ ...base, lessonId: '', })).toBeNull();
    });
});

describe('pendingCreditKey', () => {
    it('keys a credit by owner, course, and lesson', () => {
        expect(pendingCreditKey({ ownerShareCode: 'ab12', courseId: 'c', lessonId: 'b' })).toBe('ab12|c|b');
    });

    it('returns null when any part is missing', () => {
        expect(pendingCreditKey({ courseId: 'c', lessonId: 'b' })).toBeNull();
        expect(pendingCreditKey(null)).toBeNull();
        expect(pendingCreditKey()).toBeNull();
    });
});

describe('appendPendingCredit', () => {
    const b = { ownerShareCode: 'ab12', courseId: 'friendchain', lessonId: 'b' };
    const c = { ownerShareCode: 'ab12', courseId: 'friendchain', lessonId: 'c' };

    it('appends distinct lessons so each survives until signup', () => {
        expect(appendPendingCredit(appendPendingCredit([], b), c)).toEqual([b, c]);
    });

    it('collapses repeat completions of the same lesson to one entry', () => {
        expect(appendPendingCredit([b], { ...b })).toEqual([b]);
    });

    it('keeps credits for different owners apart', () => {
        const other = { ...b, ownerShareCode: 'zz99' };
        expect(appendPendingCredit([b], other)).toEqual([b, other]);
    });

    it('ignores junk without throwing and never mutates the input', () => {
        const list = [b];
        expect(appendPendingCredit(list, null)).toEqual([b]);
        expect(appendPendingCredit(list, { courseId: 'c' })).toEqual([b]);
        expect(appendPendingCredit('nope', b)).toEqual([b]);
        expect(list).toEqual([b]);
    });
});
