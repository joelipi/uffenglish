import { describe, it, expect } from 'vitest';
import friendchain from './friendchain.json';

// friendchain.json is the sample friend-challenge chain (a..h): a ping-pong of
// shareCta lessons. Lesson a records 3 prompts; each later lesson answers the
// previous lesson's prompts and records 3 brand-new prompts of its own.
// Publishing is position-based, so a lesson's recorded clips are numbered
// -response-01..NN in step order: answers first, prompts second.

const CHAIN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ANSWER_VIDEO = ['wouldratherb01', 'wouldratherb02', 'wouldratherb03'];

function lesson(id) {
    return friendchain.lessons.find((l) => l.lessonId === id);
}

describe('friendchain.json chain shape', () => {
    it('has lessons a..h in order with courseId friendchain', () => {
        expect(friendchain.courseId).toBe('friendchain');
        expect(friendchain.lessons.map((l) => l.lessonId)).toEqual(CHAIN);
    });

    it('flags every lesson recapOverlay: shareCta', () => {
        for (const l of friendchain.lessons) {
            expect(l.recapOverlay, `${l.lessonId} recapOverlay`).toBe('shareCta');
        }
    });

    it('sets recapSources none for a and friend for b..h', () => {
        expect(lesson('a').recapSources).toBe('none');
        for (const id of CHAIN.slice(1)) {
            expect(lesson(id).recapSources, `${id} recapSources`).toBe('friend');
        }
    });
});

describe('friendchain.json a: prompt recording', () => {
    it('plays/records the 3 system prompt clips', () => {
        const prompts = lesson('a').steps.filter((s) => s.responseType === 'friendClosedResponse');
        expect(prompts).toHaveLength(3);
        expect(prompts.map((s) => s.simpleVideoUrl)).toEqual(['testvideoa01', 'testvideoa02', 'testvideoa03']);
    });
});

describe('friendchain.json b: answers a and re-records the prompts', () => {
    it('plays friendchain-a-response-01..03 in viewAndContinue steps', () => {
        const views = lesson('b').steps.filter((s) => s.responseType === 'viewAndContinue');
        expect(views.map((s) => s.simpleVideoUrl)).toEqual([
            '{friendCode}friendchain-a-response-01',
            '{friendCode}friendchain-a-response-02',
            '{friendCode}friendchain-a-response-03',
        ]);
    });

    it('has exactly 3 answer steps and 3 prompt steps', () => {
        const steps = lesson('b').steps;
        const answers = steps.filter((s) => s.responseType === 'friendClosedResponse');
        expect(answers).toHaveLength(6);
        const answerClips = answers.slice(0, 3).map((s) => s.simpleVideoUrl);
        expect(answerClips).toEqual(ANSWER_VIDEO);
        const promptClips = answers.slice(3).map((s) => s.simpleVideoUrl);
        expect(promptClips).toEqual(['testvideoa01', 'testvideoa02', 'testvideoa03']);
    });
});

describe('friendchain.json c..h: answer previous prompts, record new ones', () => {
    it.each(CHAIN.slice(2))('lesson %s plays the previous lesson prompt clips -response-04..06', (id) => {
        const prev = String.fromCharCode(id.charCodeAt(0) - 1);
        const views = lesson(id).steps.filter((s) => s.responseType === 'viewAndContinue');
        expect(views.map((s) => s.simpleVideoUrl)).toEqual([
            `{friendCode}friendchain-${prev}-response-04`,
            `{friendCode}friendchain-${prev}-response-05`,
            `{friendCode}friendchain-${prev}-response-06`,
        ]);
    });

    it.each(CHAIN.slice(2))('lesson %s has exactly 3 answer steps and 3 prompt steps', (id) => {
        const answers = lesson(id).steps.filter((s) => s.responseType === 'friendClosedResponse');
        expect(answers.filter((s) => s.simpleVideoUrl && s.simpleVideoUrl.startsWith('{friendCode}')))
            .toHaveLength(0);
        // 3 answer steps (system answer clips) + 3 prompt steps (system prompt clips) = 6
        expect(answers).toHaveLength(6);
        const answerClips = answers.slice(0, 3).map((s) => s.simpleVideoUrl);
        expect(answerClips).toEqual(ANSWER_VIDEO);
        const promptClips = answers.slice(3).map((s) => s.simpleVideoUrl);
        expect(promptClips).toEqual(['testvideoa01', 'testvideoa02', 'testvideoa03']);
    });
});

describe('friendchain.json friend-slug placement', () => {
    it('every viewAndContinue in b..h uses a {friendCode} slug', () => {
        for (const id of CHAIN.slice(1)) {
            const views = lesson(id).steps.filter((s) => s.responseType === 'viewAndContinue');
            expect(views.length).toBeGreaterThan(0);
            for (const v of views) {
                expect(v.simpleVideoUrl, `${id} view slug`).toMatch(/^\{friendCode\}/);
            }
        }
    });

    it('lesson a has no friend-code slugs', () => {
        const slugs = lesson('a').steps
            .map((s) => s.simpleVideoUrl)
            .filter((u) => typeof u === 'string');
        expect(slugs.some((u) => u.startsWith('{friendCode}'))).toBe(false);
    });
});
