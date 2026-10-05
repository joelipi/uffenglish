// src/config/generated-config-contract.test.js
// Contract guard for sheet-generated configs (stories 042, 049).
//
// The generator (scripts/generate-config-from-sheet.mjs) writes NEW configs whose
// translation objects are localized-allowed: every object always carries a
// non-empty `en`, and may additionally carry only the app's generated-config
// locales (es/pt/bn). No unknown locale key and no extra key is allowed, and
// every present locale is a non-empty string. A sheet with no language columns
// still produces `{en}`, so this guard keeps its English-only strictness while
// allowing the story-049 round-trip to add es/pt/bn.
//
// This test pins that contract for the courseIds listed in
// scripts/lib/generated-configs.json (the allow-list the generator appends to).
// Existing hand-authored configs (with es/pt/bn) are deliberately NOT in the
// list, so their locale guards stay authoritative.
//
// It also pins the two invariants that model-config.test.js enforces over every
// src/config/*.json, so a generated file can never break it: canonical
// recapSources/recapOverlay, and every friend-slug step in a recapSources:
// 'friend' lesson.
//
// The allow-list starts empty; the contract is exercised against an in-memory
// fixture so it has live coverage now and applies automatically to the first
// generated course.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsMod from 'node:fs';
import * as osMod from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RECAP_SOURCES, RECAP_OVERLAYS } from '../modules/video/video-processor-logic.js';
import { FRIEND_VIDEO_REGEX } from '../modules/video/video-source.js';
import { parseCsv, buildCourseConfig, buildCourseConfigs } from '../../scripts/lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This test lives in src/config, so the config directory IS __dirname.
const CONFIG_DIR = __dirname;
const ALLOWLIST = path.join(__dirname, '../../scripts/lib/generated-configs.json');

const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

// The only locale keys a generated translation object may carry. Anything else
// (a stray fr/hi, a typo) is a contract violation.
const ALLOWED_LOCALES = ['en', 'es', 'pt', 'bn'];

function readAllowlist(listPath = ALLOWLIST) {
    const raw = JSON.parse(readFileSync(listPath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('generated-configs.json must be an array of courseIds');
    return raw;
}

// The shipped "every listed generated config satisfies the contract" loop, as a
// function of the allow-list path + config directory so a test can point it at a
// temp set (and the real test can call it with the tracked defaults). Requires
// N > 1 to be meaningful — a loop over an empty/singleton set proves nothing.
function assertListedConfigs({ listPath = ALLOWLIST, readDir = CONFIG_DIR } = {}) {
    const listed = readAllowlist(listPath);
    for (const courseId of listed) {
        const file = path.join(readDir, `${courseId}.json`);
        const config = JSON.parse(readFileSync(file, 'utf8'));
        assertGeneratedConfigContract(config, courseId);
    }
    return listed.length;
}

// Every translation slot in a course config, walked structurally (NOT keyed on
// `en`'s presence — a `{ es: … }`-only object must still be caught).
//   title/mission: an object of locale->string
//   cue: an object OR an array of such objects
//   subtitles: an object of locale->string
function collectTranslationObjects(node, found = []) {
    if (Array.isArray(node)) { node.forEach((n) => collectTranslationObjects(n, found)); return found; }
    if (!node || typeof node !== 'object') return found;
    for (const key of ['title', 'mission', 'subtitles']) {
        const value = node[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) found.push(value);
    }
    if ('cue' in node) {
        const cue = node.cue;
        if (Array.isArray(cue)) cue.forEach((c) => { if (c && typeof c === 'object') found.push(c); });
        else if (cue && typeof cue === 'object') found.push(cue);
    }
    for (const value of Object.values(node)) collectTranslationObjects(value, found);
    return found;
}

// The contract applied to one config object. Throws with a specific message on
// the first violation.
function assertGeneratedConfigContract(config, label) {
    for (const obj of collectTranslationObjects(config)) {
        const keys = Object.keys(obj);
        // No unknown/extra locale key.
        for (const key of keys) {
            expect(ALLOWED_LOCALES, `${label}: unknown locale key "${key}"`).toContain(key);
        }
        // `en` is always present and a non-empty string.
        expect(typeof obj.en, `${label}: en is a string`).toBe('string');
        expect(obj.en.length, `${label}: en is non-empty`).toBeGreaterThan(0);
        // Every present locale value is a non-empty string.
        for (const key of keys) {
            expect(typeof obj[key], `${label}: ${key} is a string`).toBe('string');
            expect(obj[key].length, `${label}: ${key} is non-empty`).toBeGreaterThan(0);
        }
    }
    for (const lesson of config.lessons) {
        if (lesson.recapSources !== undefined) {
            expect(RECAP_SOURCES, `${label} lesson ${lesson.lessonId}`).toContain(lesson.recapSources);
        }
        if (lesson.recapOverlay !== undefined) {
            expect(RECAP_OVERLAYS, `${label} lesson ${lesson.lessonId}`).toContain(lesson.recapOverlay);
        }
        const hasFriendSlug = (lesson.steps || []).some((step) =>
            VIDEO_FIELDS.some((field) => FRIEND_VIDEO_REGEX.test(step[field] || ''))
        );
        if (hasFriendSlug) {
            expect(lesson.recapSources, `${label} lesson ${lesson.lessonId} friend-slug`).toBe('friend');
        }
    }
}

const FIXTURE_CSV = [
    'course_id,course_name,lesson_id,lesson_title,recap_sources,recap_overlay,response_type,video_file,filename,order,subtitle_text',
    'gen,Generated,a,Lesson A,none,shareCta,viewAndContinue,gen-v1,gen-v101,1,Hi.',
    'gen,Generated,b,Lesson B,friend,shareCta,viewAndContinue,ab-model-w-response-01,ab1,1,Hello.',
].join('\n');

// A sheet with the story-049 language columns, so the generated object carries
// es/pt/bn and the localized-allowed contract must accept it.
const LOCALIZED_CSV = [
    'course_id,course_name,lesson_id,lesson_title,lesson_title_es,lesson_title_pt,lesson_title_bn,mission,mission_es,response_type,video_file,filename,order,cue,cue_es,subtitle_text,subtitle_text_es',
    'loc,Localized,a,Lesson A,Lección A,Llição A,পাঠ এ,Talk,Falar,viewAndContinue,loc-v1,loc1,1,,,Hi.,Hola.',
    'loc,Localized,a,Lesson A,,,,,,friendClosedResponse,loc-q,locq1,2,Question?,¿Pregunta?,,',
].join('\n');

describe('generated config contract (localized allowed)', () => {
    it('passes for a well-formed fixture (can also fail — see below)', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        assertGeneratedConfigContract(buildCourseConfig(rows), 'fixture');
    });

    it('passes for {en}', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        expect(config.lessons[0].title).toEqual({ en: 'Lesson A' });
        assertGeneratedConfigContract(config, 'en-only');
    });

    it('passes for {en,es}', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title.es = 'Lección A';
        assertGeneratedConfigContract(config, 'en-es');
    });

    it('passes for {en,es,pt,bn} built from the language columns', () => {
        const { rows } = parseCsv(LOCALIZED_CSV);
        const config = buildCourseConfig(rows);
        expect(config.lessons[0].title).toEqual({ en: 'Lesson A', es: 'Lección A', pt: 'Llição A', bn: 'পাঠ এ' });
        expect(config.lessons[0].mission).toEqual({ en: 'Talk', es: 'Falar' });
        assertGeneratedConfigContract(config, 'localized');
    });

    it('fails when a translation object carries an unknown locale key', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title.fr = 'Leçon';
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow(/unknown locale key/);
    });

    it('fails when a translation slot omits en entirely', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title = { es: 'Lección' };
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('fails when a locale value is an empty string', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title.es = '';
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('fails when a locale value is not a string', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title.es = 42;
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('fails when a friend-slug step is not in a recapSources: friend lesson', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[1].recapSources = 'none';
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('every listed generated config satisfies the contract', () => {
        assertListedConfigs();
    });

    // Story 046: the contract must hold for N generated files, not just one, and
    // the multi-course transform must feed it correctly (a guard over a
    // one-element set is under-tested — docs/learnings.md).
    const TWO_COURSE_CSV = [
        'course_id,course_name,lesson_id,lesson_title,recap_sources,recap_overlay,response_type,video_file,filename,order,subtitle_text',
        'alpha,Alpha,a,Lesson A,none,shareCta,viewAndContinue,alpha-v1,alpha1,1,Hi.',
        'beta,Beta,b,Lesson B,friend,shareCta,viewAndContinue,ab-model-w-response-01,ab1,1,Hey.',
    ].join('\n');

    it('holds for every course in a multi-course fixture (N > 1)', () => {
        const results = buildCourseConfigs(parseCsv(TWO_COURSE_CSV).rows);
        expect(results).toHaveLength(2);
        for (const r of results) assertGeneratedConfigContract(r.config, r.courseId);
    });

    it('can fail on the second course, not just the first', () => {
        const results = buildCourseConfigs(parseCsv(TWO_COURSE_CSV).rows);
        results[1].config.lessons[0].title.fr = 'Leçon';
        expect(() => results.forEach((r) => assertGeneratedConfigContract(r.config, r.courseId))).toThrow();
    });

    it('rejects a non-canonical recapSources, naming the course', () => {
        const results = buildCourseConfigs(parseCsv(TWO_COURSE_CSV).rows);
        results[0].config.lessons[0].recapSources = 'bogus';
        expect(() => assertGeneratedConfigContract(results[0].config, results[0].courseId)).toThrow(/alpha/);
    });
});

// Story 046, Task 3 AC 3: the shipped allow-list loop must iterate N > 1 files.
// The real allow-list is empty, so this drives the SAME `assertListedConfigs`
// function the shipped test calls, pointed at a temp list + temp configs (a
// guard over an empty set proves nothing — docs/learnings.md).
describe('contract guard allow-list loop (N > 1, temp seam)', () => {
    it('iterates every listed course and throws on a non-canonical one', () => {
        const dir = fsMod.mkdtempSync(path.join(osMod.tmpdir(), 'uff-contract-'));
        const TWO_COURSE_CSV = [
            'course_id,course_name,lesson_id,lesson_title,recap_sources,recap_overlay,response_type,video_file,filename,order',
            'alpha,Alpha,a,Lesson A,none,shareCta,viewAndContinue,alpha-v1,alpha1,1',
            'beta,Beta,b,Lesson B,friend,shareCta,viewAndContinue,ab-model-w-response-01,ab1,1',
        ].join('\n');
        try {
            for (const r of buildCourseConfigs(parseCsv(TWO_COURSE_CSV).rows)) {
                fsMod.writeFileSync(path.join(dir, `${r.courseId}.json`), JSON.stringify(r.config));
            }
            const listPath = path.join(dir, 'allow.json');
            fsMod.writeFileSync(listPath, JSON.stringify(['alpha', 'beta']));

            // The real loop iterates both valid files.
            expect(assertListedConfigs({ listPath, readDir: dir })).toBe(2);

            // Break the second listed course -> the real loop must throw,
            // naming that course.
            const beta = JSON.parse(readFileSync(path.join(dir, 'beta.json'), 'utf8'));
            beta.lessons[0].recapSources = 'bogus';
            fsMod.writeFileSync(path.join(dir, 'beta.json'), JSON.stringify(beta));
            expect(() => assertListedConfigs({ listPath, readDir: dir })).toThrow(/beta/);
        } finally { fsMod.rmSync(dir, { recursive: true, force: true }); }
    });
});
