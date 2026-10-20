import { describe, it, expect } from 'vitest';
import wouldyourather from '../../config/wouldyourather.json';
import wouldyouratherTest from '../../config/wouldyourather-test.json';
import { resolveNextStepIndex, resolveBranchChoices } from '../lesson/branch-choice-logic.js';
import {
    assignSegmentTargets,
    buildUgcSegmentKey,
    resolveInviterCode,
} from '../video/video-processor-logic.js';
import { resolveShareCodes } from '../bilingual/config-normalizer.js';

/**
 * The friend chain's addressing guard.
 *
 * Every lesson after the first plays a friend's clip, and the clip it plays is
 * the PREVIOUS learner's contribution to that namespace. The learner who opens
 * the previous learner's link is the one who computes the R2 key, so the key
 * has to be derivable from the friend's code alone — the friend published the
 * clip, the reader has to find it.
 *
 * This walks a whole chain with the app's own logic (the visit path, the
 * publish targets, the key builder, the reference resolver) and asserts that
 * every friend reference in the config addresses a clip that somebody in the
 * chain actually published. The old rules broke it: the reader asked for
 * `<friend>-<viewer>` (a key nobody writes) or, for the ask namespace,
 * `<friend>-<friend>` (which only the chain's originator ever wrote, so the
 * second learner of the chain was already broken).
 */

const FRIEND_RESPONSE_TYPE = 'friendClosedResponse';

/** The steps a learner actually visits, following the FIRST leaf of each branch. */
function visitPath(lesson) {
    const steps = lesson.steps;
    const visited = [];
    let i = 0;
    let guard = 0;
    while (i < steps.length && guard++ < 1000) {
        const step = steps[i];
        visited.push(step);
        if (step.responseType === 'branching') {
            const leaves = resolveBranchChoices(step, i, steps.length);
            if (!leaves.length) {
                i = resolveNextStepIndex(step, i);
                continue;
            }
            i = leaves[0].targetIndex;
            continue;
        }
        i = resolveNextStepIndex(step, i);
    }
    return visited;
}

/** The clips a learner records in a lesson, and the key each is published under. */
function publishedClips(lesson, recorder, courseId) {
    const recorded = visitPath(lesson).filter((step) => step.responseType === FRIEND_RESPONSE_TYPE);
    const targets = assignSegmentTargets(
        recorded.map((step) => ({ publishLessonId: step.publishLessonId })),
        lesson.lessonId,
    );
    return recorded.map((step, i) => buildUgcSegmentKey({
        shareCode: recorder,
        inviterCode: resolveInviterCode({ shareCode: recorder }),
        courseId,
        lessonId: targets[i].lessonId,
        index: targets[i].index,
    }));
}

/** Every friend reference of a lesson (the clips it plays from a friend). */
function friendReferences(lesson) {
    return [...new Set(lesson.steps
        .map((step) => step.simpleVideoUrl || step.introBackgroundVideoUrl || '')
        .filter((url) => url.includes('{friendCode}')))];
}

const COURSES = [
    { name: 'wouldyourather', config: wouldyourather },
    { name: 'wouldyourather-test', config: wouldyouratherTest },
];

describe('friend chain addressing', () => {
    for (const { name, config } of COURSES) {
        it(`${name}: every friend reference addresses a clip the chain publishes`, () => {
            const lessons = config.lessons;
            // One learner per lesson, in config order: learner 0 plays the first
            // lesson, learner 1 plays the next one (they opened learner 0's
            // link), and so on — the chain the profile links walk.
            const learners = lessons.map((lesson, i) => ({
                lessonId: lesson.lessonId,
                code: `code${i}`,
            }));

            const published = new Set();
            for (const learner of learners) {
                const lesson = lessons.find((l) => l.lessonId === learner.lessonId);
                for (const key of publishedClips(lesson, learner.code, name)) {
                    published.add(key);
                }
            }

            const unresolved = [];
            lessons.forEach((lesson, i) => {
                if (i === 0) return;                 // the ask lesson plays no friend clip
                const reader = learners[i];
                const friend = learners[i - 1];     // the link the reader opened
                for (const ref of friendReferences(lesson)) {
                    const resolved = resolveShareCodes(ref, {
                        friendCode: friend.code,
                        selfCode: reader.code,
                    });
                    const key = `videos/${resolved}.mp4`;
                    if (!published.has(key)) unresolved.push(`${lesson.lessonId}: ${ref} -> ${key}`);
                }
            });

            expect(unresolved).toEqual([]);
        });

        it(`${name}: the chain's namespaces are published by the learner the next lesson plays`, () => {
            // The clip a lesson plays comes from the namespace the PREVIOUS
            // learner published into, and the index the reference asks for is
            // the index the publisher wrote.
            const lessons = config.lessons;
            const learners = lessons.map((lesson, i) => ({
                lessonId: lesson.lessonId,
                code: `code${i}`,
            }));
            const byLesson = new Map();
            learners.forEach((learner) => {
                const lesson = lessons.find((l) => l.lessonId === learner.lessonId);
                byLesson.set(learner.lessonId, publishedClips(lesson, learner.code, name));
            });

            const mismatches = [];
            lessons.forEach((lesson, i) => {
                if (i === 0) return;
                const friend = learners[i - 1];
                const friendKeys = byLesson.get(friend.lessonId);
                for (const ref of friendReferences(lesson)) {
                    const resolved = resolveShareCodes(ref, {
                        friendCode: friend.code,
                        selfCode: learners[i].code,
                    });
                    if (!friendKeys.includes(`videos/${resolved}.mp4`)) {
                        mismatches.push(`${lesson.lessonId}: ${ref} -> ${resolved}`);
                    }
                }
            });

            expect(mismatches).toEqual([]);
        });
    }

    it('the key the reader asks for is the key the publisher wrote', () => {
        // The failure mode this guard exists for: the reader used to ask for
        // `<friend>-<viewer>`, a key no publisher ever writes.
        const ref = '{friendCode}{selfCode}-wouldyourather-a-01';
        const friend = 'friendcode';
        const reader = 'readercode';
        const published = buildUgcSegmentKey({
            shareCode: friend,
            inviterCode: resolveInviterCode({ shareCode: friend }),
            courseId: 'wouldyourather',
            lessonId: 'a',
            index: 1,
        });
        const asked = `videos/${resolveShareCodes(ref, { friendCode: friend, selfCode: reader })}.mp4`;
        expect(asked).toBe(published);
        // The viewer's own code is nowhere in the key it asks for.
        expect(asked).not.toContain(reader);
    });
});
