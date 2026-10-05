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

describe('friend-slug invariant', () => {
    // Any step whose prompt video is a friend/UGC slug (-response-NN) must
    // belong to a lesson flagged recapSources: 'friend'. Otherwise the planner
    // would silently drop the friend's clips from that lesson's recap.
    // Keep VIDEO_FIELDS in sync with _getRemoteTarget's field precedence
    // (video-processor-logic.js): interactiveVideoUrl > introBackgroundVideoUrl
    // > simpleVideoUrl.
    const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

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
});
