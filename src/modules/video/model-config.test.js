import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RECAP_SOURCES, RECAP_OVERLAYS } from './video-processor-logic.js';
import { FRIEND_VIDEO_REGEX } from './video-source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '../../config');
// The app fetches any /src/config/${courseId}.json (AppLayout.jsx:18), so the
// generic guards below run over every course config, not just the two edited
// here.
const CONFIG_FILES = readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));

function loadConfig(name) {
    return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

describe('model.json recap flags', () => {
    const model = loadConfig('model.json');

    it('has no friend-challenge lessons (shareCta flags removed)', () => {
        const flagged = model.lessons
            .filter(l => l.recapSources !== undefined || l.recapOverlay !== undefined)
            .map(l => l.lessonId);

        expect(flagged).toEqual([]);
    });

    it('removes webcamOnly from every lesson', () => {
        const flagged = model.lessons
            .filter(l => l.webcamOnly !== undefined)
            .map(l => l.lessonId);

        expect(flagged).toEqual([]);
    });
});

describe('friend.json recap flags', () => {
    const friend = loadConfig('friend.json');

    it('sets recapSources/recapOverlay on lessons a and b', () => {
        const a = friend.lessons.find(l => l.lessonId === 'a');
        const b = friend.lessons.find(l => l.lessonId === 'b');
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a.recapSources).toBe('none');
        expect(a.recapOverlay).toBe('shareCta');
        expect(b.recapSources).toBe('friend');
        expect(b.recapOverlay).toBe('shareCta');
    });

    it('removes webcamOnly from every lesson', () => {
        const flagged = friend.lessons
            .filter(l => l.webcamOnly !== undefined)
            .map(l => l.lessonId);

        expect(flagged).toEqual([]);
    });
});

describe('recap flag values are valid', () => {
    it.each([
        ['recapSources', RECAP_SOURCES],
        ['recapOverlay', RECAP_OVERLAYS],
    ])('every %s value is one of the canonical list', (flag, allowed) => {
        for (const name of CONFIG_FILES) {
            const config = loadConfig(name);
            for (const lesson of config.lessons) {
                if (lesson[flag] !== undefined) {
                    expect(allowed).toContain(lesson[flag]);
                }
            }
        }
    });
});

describe('test.json click-through friend prompts', () => {
    const testConfig = loadConfig('test.json');
    const lesson = testConfig.lessons.find(l => l.lessonId === 'b');
    // The teacher's explanatory clips that follow each friend question.
    const RESPONSE_CLIPS = ['testvideo05', 'testvideo06', 'testvideo07'];

    it('flags lesson b as a friend recap', () => {
        expect(lesson, 'test.json lesson b should exist').toBeDefined();
        expect(lesson.recapSources).toBe('friend');
    });

    it('presents each friend question as a click-through clip with no cue or subtitles', () => {
        const viewSteps = lesson.steps.filter(s => s.responseType === 'viewAndContinue');
        expect(viewSteps.length).toBeGreaterThan(0);
        for (const step of viewSteps) {
            expect(step.simpleVideoUrl).toMatch(FRIEND_VIDEO_REGEX);
            expect(step.cue).toBeUndefined();
            expect(step.subtitles).toBeUndefined();
        }
    });

    it('follows each friend clip with an explanatory recorded response step', () => {
        lesson.steps.forEach((step, i) => {
            if (step.responseType !== 'viewAndContinue') return;
            const next = lesson.steps[i + 1];
            expect(next?.responseType).toBe('friendClosedResponse');
            expect(RESPONSE_CLIPS).toContain(next?.simpleVideoUrl);
            expect(next?.cue).toBeDefined();
        });
    });
});

// Story 057: the wouldyourather lesson b `branching` step is a friend UGC clip
// (`{friendCode}wouldyourather-a-response-01`) whose caption is burned in, so it
// must carry no app `subtitles`; its slug and choices are unchanged.
describe('wouldyourather lesson b branching step', () => {
    const config = loadConfig('wouldyourather.json');
    const lesson = config.lessons.find(l => l.lessonId === 'b');
    const step = lesson.steps[1];

    it('is the branching friend step with no app subtitles', () => {
        expect(step.responseType).toBe('branching');
        expect(step.simpleVideoUrl).toBe('{friendCode}wouldyourather-a-response-01');
        expect('subtitles' in step).toBe(false);
    });

    it('keeps its chooseStep choices', () => {
        expect(step.chooseStep).toEqual([
            { nextStep: 1, text: { en: '$1,000,000 today', es: '$1,000,000 hoy', pt: '$1.000.000 hoje', bn: '$1,000,000 আজ' } },
            { nextStep: 2, text: { en: '$5,000,000 in 5 years', es: '$5,000,000 en 5 años', pt: '$5.000.000 em 5 anos', bn: '$5,000,000 ৫ বছরে' } },
        ]);
    });
});

describe('friend-slug invariant', () => {
    // Any step whose prompt video is a friend/UGC slug (-response-NN) must
    // belong to a lesson flagged recapSources: 'friend'. Otherwise the planner
    // would silently drop the friend's clips from that lesson's recap.
    // Keep VIDEO_FIELDS in sync with _getRemoteTarget's field precedence
    // (video-processor-logic.js): interactiveVideoUrl > introBackgroundVideoUrl
    // > simpleVideoUrl.
    const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

    // Story 057: a friend/UGC clip already carries its speaker's caption burned
    // into the video, so the config must not give it app `subtitles` (the player
    // would draw a second caption over the clip).
    const assertNoFriendSubtitles = (configs) => {
        for (const { name, config } of configs) {
            for (const lesson of config.lessons) {
                for (const step of lesson.steps || []) {
                    const isFriend = VIDEO_FIELDS.some(field => FRIEND_VIDEO_REGEX.test(step[field] || ''));
                    if (isFriend) {
                        expect(step.subtitles, `${name} lesson ${lesson.lessonId}`).toBeUndefined();
                    }
                }
            }
        }
    };

    it('every friend-slug step lives in a recapSources: friend lesson', () => {
        for (const name of CONFIG_FILES) {
            const config = loadConfig(name);
            for (const lesson of config.lessons) {
                const hasFriendSlug = (lesson.steps || []).some(step =>
                    VIDEO_FIELDS.some(field => FRIEND_VIDEO_REGEX.test(step[field] || ''))
                );
                if (hasFriendSlug) {
                    expect(lesson.recapSources, `${name} lesson ${lesson.lessonId}`).toBe('friend');
                }
            }
        }
    });

    it('no friend-slug step carries app subtitles', () => {
        assertNoFriendSubtitles(CONFIG_FILES.map(name => ({ name, config: loadConfig(name) })));
    });

    it('the no-subtitles guard can fail on a mutated friend step', () => {
        const configs = [{
            name: 'synthetic',
            config: { lessons: [{ lessonId: 'b', steps: [{ simpleVideoUrl: 'ab-x-b-response-01' }] }] },
        }];
        expect(() => assertNoFriendSubtitles(configs)).not.toThrow();
        configs[0].config.lessons[0].steps[0].subtitles = { en: 'dup' };
        expect(() => assertNoFriendSubtitles(configs)).toThrow();
    });
});
