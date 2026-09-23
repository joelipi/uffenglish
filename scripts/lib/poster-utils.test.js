// scripts/lib/poster-utils.test.js
// Pure poster-generation utilities (stories/011-auto-intro-poster, Task 1).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    FRAME_AT_SECONDS,
    POSTER_WIDTH,
    POSTER_QUALITY,
    POSTER_MAX_BYTES,
    LQIP_WIDTH,
    exceedsPosterBudget,
    introTargets,
    posterFilename,
    posterR2Key,
    posterSourceUrl,
    planPosterRun,
    formatLqipModule,
} from './poster-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '../../src/config');

function loadAllConfigs() {
    return readdirSync(CONFIG_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(CONFIG_DIR, f), 'utf8')));
}

async function importModule(js) {
    const b64 = Buffer.from(js, 'utf8').toString('base64');
    return import(`data:text/javascript;base64,${b64}`);
}

describe('introTargets', () => {
    it('returns only first-step intro slugs', () => {
        const configs = [
            {
                lessons: [
                    { lessonId: 'a', steps: [{ responseType: 'lessonIntro', introBackgroundVideoUrl: 'slug-a' }] },
                    // first step is not an intro
                    { lessonId: 'b', steps: [{ responseType: 'closedResponse', cue: 'hi' }] },
                    // no steps
                    { lessonId: 'c' },
                    // steps[0] lacks the field
                    { lessonId: 'd', steps: [{ responseType: 'closedResponse', cue: 'q' }] },
                    // intro only on a later step
                    { lessonId: 'e', steps: [{ cue: 'q' }, { cue: 'q2' }, { introBackgroundVideoUrl: 'slug-late' }] },
                ],
            },
        ];
        expect(introTargets(configs)).toEqual([{ slug: 'slug-a' }]);
    });

    it('dedupes a slug reused across lessons and configs (first-seen order)', () => {
        const configs = [
            { lessons: [{ steps: [{ introBackgroundVideoUrl: 'shared' }] }] },
            { lessons: [{ steps: [{ introBackgroundVideoUrl: 'shared' }] }, { steps: [{ introBackgroundVideoUrl: 'other' }] }] },
        ];
        expect(introTargets(configs)).toEqual([{ slug: 'shared' }, { slug: 'other' }]);
    });

    it('handles empty / missing configs', () => {
        expect(introTargets([])).toEqual([]);
        expect(introTargets([{}])).toEqual([]);
        expect(introTargets([{ lessons: [] }])).toEqual([]);
        expect(introTargets(null)).toEqual([]);
    });

    it('finds exactly the five first-step intro slugs across all configs', () => {
        const slugs = introTargets(loadAllConfigs()).map((t) => t.slug).sort();
        expect(slugs).toEqual(
            ['do_you_have_dark_chocolate', 'do_you_have_rolls_too', 'gtests-0-1-1', 'gtests-1-0', 'testvideo01'],
        );
    });
});

describe('poster naming', () => {
    it('posterFilename and posterR2Key use the slug sibling rule', () => {
        expect(posterFilename('do_you_have_rolls_too')).toBe('do_you_have_rolls_too.jpg');
        expect(posterR2Key('do_you_have_rolls_too')).toBe('assets/videos/do_you_have_rolls_too.jpg');
    });

    it('posterSourceUrl points at the R2 mp4 sibling', () => {
        expect(posterSourceUrl('testvideo01')).toBe('https://r2.ultrafastfluency.com/assets/videos/testvideo01.mp4');
    });
});

describe('planPosterRun', () => {
    const configs = [{ lessons: [{ steps: [{ introBackgroundVideoUrl: 'a' }] }, { steps: [{ introBackgroundVideoUrl: 'b' }] }] }];

    it('targets only slugs whose poster is absent; rebuild when there is work', () => {
        const moduleText = 'export const POSTER_LQIPS = { "a": "x", "b": "y" };';
        const plan = planPosterRun({ configs, posterExists: (s) => s !== 'a', moduleText });
        expect(plan.targets).toEqual([{ slug: 'a' }]);
        expect(plan.rebuild).toBe(true);
    });

    it('all posters present + complete module -> no targets, no rebuild', () => {
        const moduleText = 'export const POSTER_LQIPS = { "a": "x", "b": "y" };';
        expect(planPosterRun({ configs, posterExists: () => true, moduleText }))
            .toEqual({ targets: [], rebuild: false });
    });

    it('all posters present + null module -> rebuild', () => {
        expect(planPosterRun({ configs, posterExists: () => true, moduleText: null }))
            .toEqual({ targets: [], rebuild: true });
    });

    it('all posters present + module omits a slug -> rebuild', () => {
        const moduleText = 'export const POSTER_LQIPS = { "a": "x" };';
        const plan = planPosterRun({ configs, posterExists: () => true, moduleText });
        expect(plan.targets).toEqual([]);
        expect(plan.rebuild).toBe(true);
    });
});

describe('constants and budget', () => {
    it('exposes the tuned constants', () => {
        expect(FRAME_AT_SECONDS).toBe(0.2);
        expect(POSTER_WIDTH).toBe(640);
        expect(POSTER_QUALITY).toBe(8);
        expect(POSTER_MAX_BYTES).toBe(32768);
        expect(LQIP_WIDTH).toBe(32);
    });

    it('exceedsPosterBudget is strict greater-than', () => {
        expect(exceedsPosterBudget(32768)).toBe(false);
        expect(exceedsPosterBudget(32769)).toBe(true);
        expect(exceedsPosterBudget(19653)).toBe(false);
    });
});

describe('formatLqipModule', () => {
    it('emits a valid slug-keyed module', async () => {
        const dataUri = 'data:image/jpeg;base64,AAA';
        const js = formatLqipModule({ do_you_have_rolls_too: dataUri });
        expect(js).toContain('POSTER_LQIPS');
        expect(js).toContain('getPosterLqip');
        expect(js).toContain('"do_you_have_rolls_too"');
        expect(js).toContain(dataUri);
        const mod = await importModule(js);
        expect(mod.POSTER_LQIPS.do_you_have_rolls_too).toBe(dataUri);
        expect(mod.getPosterLqip('do_you_have_rolls_too')).toBe(dataUri);
        expect(mod.getPosterLqip('nope')).toBeNull();
    });

    it('emits an empty map that still exports getPosterLqip', async () => {
        const mod = await importModule(formatLqipModule({}));
        expect(mod.POSTER_LQIPS).toEqual({});
        expect(typeof mod.getPosterLqip).toBe('function');
        expect(mod.getPosterLqip('anything')).toBeNull();
    });
});
