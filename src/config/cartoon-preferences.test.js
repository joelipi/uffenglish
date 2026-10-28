// Guide for the generated cartoon-preferences config (stories/099-course-intro-clips).
//
// The course declares three short intro clips in its source
// (`sources/cartoon-preferences.source.txt`), and the ABABAB generator places
// the derived slugs at deterministic points:
//   -intro-first    lesson A's first ask branch (frames the whole course)
//   -intro-respond  every answer lesson's opener, before the friend's clip
//   -intro-ask      every later lesson's ask-phase opener ("now it's your turn")
//
// The clips are recorded and uploaded separately, so this guard pins PLACEMENT
// and the three-slug set, never the media or their subtitles.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from './cartoon-preferences.json';
import wouldyourather from './wouldyourather.json';
import health from './health.json';
import { parseCsv } from '../../scripts/lib/sheet-config-utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const COURSE = 'cartoon-preferences';
const INTRO_SLUG = new RegExp(`${COURSE}-intro-(first|respond|ask)`, 'g');

const lesson = (id) => config.lessons.find((l) => l.lessonId === id);
const introSlugsIn = (steps) => steps
    .flatMap((s) => [s.simpleVideoUrl, s.introBackgroundVideoUrl])
    .filter((slug) => typeof slug === 'string' && slug.startsWith(`${COURSE}-intro-`));
const allIntroSlugs = () => {
    const found = JSON.stringify(config).match(INTRO_SLUG) || [];
    return [...new Set(found)].sort();
};

describe('cartoon-preferences intro clips', () => {
    it('defines exactly the three derived intro slugs', () => {
        expect(allIntroSlugs()).toEqual([
            `${COURSE}-intro-ask`,
            `${COURSE}-intro-first`,
            `${COURSE}-intro-respond`,
        ]);
    });

    it('lesson A opens its ask phase on the first-lesson clip, once', () => {
        const a = lesson('a');
        expect(a.steps[0].responseType).toBe('lessonIntro');
        expect(a.steps[1].responseType).toBe('branching');
        expect(a.steps[1].simpleVideoUrl).toBe(`${COURSE}-intro-first`);
        expect(introSlugsIn(a.steps)).toEqual([`${COURSE}-intro-first`]);
    });

    it.each(['b', 'c', 'd', 'e', 'f', 'g'])(
        'lesson %s opens with the respond clip, before the friend-clip branch',
        (id) => {
            const steps = lesson(id).steps;
            expect(steps[0].responseType).toBe('lessonIntro');
            expect(steps[1]).toEqual({
                responseType: 'viewAndContinue',
                simpleVideoUrl: `${COURSE}-intro-respond`,
            });
            // The first branch keeps the friend's clip; the intro never steals it.
            expect(steps[2].responseType).toBe('branching');
            expect(steps[2].simpleVideoUrl).toContain('{friendCode}');
        }
    );

    it.each(['b', 'c', 'd', 'e', 'f'])(
        'lesson %s opens its ask phase on the "your turn" clip, once',
        (id) => {
            const introBranches = lesson(id).steps.filter(
                (s) => s.responseType === 'branching' && s.simpleVideoUrl === `${COURSE}-intro-ask`
            );
            expect(introBranches).toHaveLength(1);
        }
    );

    it('the closing lesson never plays the "your turn" clip (it closes instead)', () => {
        expect(JSON.stringify(lesson('g').steps)).not.toContain(`${COURSE}-intro-ask`);
    });

    it('keeps the generated step counts with the extra opener steps', () => {
        expect(lesson('a').steps).toHaveLength(16);
        for (const id of ['b', 'c', 'd', 'e', 'f']) expect(lesson(id).steps).toHaveLength(44);
        expect(lesson('g').steps).toHaveLength(34);
    });

    it('keeps every intro slug an ordinary R2 video slug (no friend template)', () => {
        for (const slug of allIntroSlugs()) {
            expect(slug).toMatch(new RegExp(`^${COURSE}-intro-(first|respond|ask)$`));
            expect(slug).not.toContain('{');
        }
    });
});

describe('the intros block is opt-in', () => {
    it('the other generated courses carry no intro clip', () => {
        for (const other of [wouldyourather, health]) {
            expect(JSON.stringify(other)).not.toMatch(/-intro-(first|respond|ask)/);
        }
    });
});

describe('the cartoon source still declares the three scripts', () => {
    const source = JSON.parse(
        readFileSync(path.join(ROOT, 'sources', 'cartoon-preferences.source.txt'), 'utf8')
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('//'))
            .join('\n')
    );

    it('declares exactly first, respond and ask', () => {
        expect(Object.keys(source.intros).sort()).toEqual(['ask', 'first', 'respond']);
    });
    it('keeps each script short and non-empty', () => {
        for (const [kind, script] of Object.entries(source.intros)) {
            expect(script, kind).toBeTypeOf('string');
            expect(script.trim(), kind).not.toBe('');
            expect(script.trim().split(/\s+/).length, kind).toBeLessThanOrEqual(80);
        }
    });

    it('frames the right speaker in each script', () => {
        expect(source.intros.first).toMatch(/You're asking your friend/i);
        expect(source.intros.respond).toMatch(/Your friend is asking you/i);
        expect(source.intros.ask).toMatch(/your turn to ask your friend/i);
    });
});

describe('the cartoon master CSV carries the intro_kinds column', () => {
    it('marks every data row with the full three-kind set', () => {
        const text = readFileSync(path.join(ROOT, 'public', 'cartoon-preferences.master.csv'), 'utf8');
        const { headers, rows } = parseCsv(text);
        expect(headers).toContain('intro_kinds');
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.intro_kinds).toBe('first|respond|ask');
    });
});
