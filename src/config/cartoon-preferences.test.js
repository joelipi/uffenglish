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

    it('declares exactly first, respond and ask as arrays of short lines', () => {
        expect(Object.keys(source.intros).sort()).toEqual(['ask', 'first', 'respond']);
        for (const [kind, lines] of Object.entries(source.intros)) {
            expect(lines, kind).toBeInstanceOf(Array);
            expect(lines.length, kind).toBeGreaterThan(0);
            expect(lines.length, kind).toBeLessThanOrEqual(6);
            for (const line of lines) {
                expect(line.trim(), kind).not.toBe('');
                // The recorder shows one line at 9vw, so a line must stay short.
                expect(line.trim().split(/\s+/).length, kind).toBeLessThanOrEqual(20);
            }
        }
    });

    it('frames the right speaker in each opener', () => {
        expect(source.intros.first[0]).toMatch(/You're asking your friend/i);
        expect(source.intros.respond[0]).toMatch(/Your friend is asking you/i);
        expect(source.intros.ask[0]).toMatch(/your turn to ask your friend/i);
    });
});

describe('the cartoon master CSV carries one intro take per line', () => {
    const text = readFileSync(path.join(ROOT, 'public', 'cartoon-preferences.master.csv'), 'utf8');
    const { headers, rows } = parseCsv(text);
    const introRows = rows.filter((row) => row.set_role === 'intro');

    it('has one recordable take per line, grouped by the derived slug', () => {
        expect(headers).toContain('title_text');
        expect(introRows.map((row) => row.filename)).toEqual([
            `${COURSE}-intro-first-01`,
            `${COURSE}-intro-first-02`,
            `${COURSE}-intro-first-03`,
            `${COURSE}-intro-respond-01`,
            `${COURSE}-intro-respond-02`,
            `${COURSE}-intro-respond-03`,
            `${COURSE}-intro-ask-01`,
            `${COURSE}-intro-ask-02`,
        ]);
        for (const row of introRows) {
            expect(row.video_file, row.filename).toMatch(new RegExp(`^${COURSE}-intro-(first|respond|ask)$`));
            expect(row.response_type, row.filename).toBe('viewAndContinue');
            expect(row.phrase.trim(), row.filename).not.toBe('');
            expect(row.order, row.filename).toMatch(/^[1-9]$/);
        }
    });

    it('burns no title/rung text onto a selfie opener', () => {
        for (const row of introRows) {
            expect(row.title_text, row.filename).toBe('');
            expect(row.subtitle_text, row.filename).toBe('');
            expect(row.footer_text, row.filename).toBe('');
        }
    });
});
