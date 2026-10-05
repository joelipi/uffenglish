// src/config/generated-config-contract.test.js
// Contract guard for sheet-generated, English-only configs (story 042).
//
// The generator (scripts/generate-config-from-sheet.mjs) writes NEW configs that
// carry only `en` in every translation object. This test pins that contract for
// the courseIds listed in scripts/lib/generated-configs.json (the allow-list the
// generator appends to). Existing hand-authored configs (with es/pt/bn) are
// deliberately NOT in the list, so their locale guards stay authoritative.
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

function readAllowlist() {
    const raw = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('generated-configs.json must be an array of courseIds');
    return raw;
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
        expect(Object.keys(obj), `${label}: translation object has only en`).toEqual(['en']);
        expect(typeof obj.en, `${label}: en is a string`).toBe('string');
        expect(obj.en.length, `${label}: en is non-empty`).toBeGreaterThan(0);
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

describe('generated English-only config contract', () => {
    it('passes for a well-formed fixture (can also fail — see below)', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        assertGeneratedConfigContract(buildCourseConfig(rows), 'fixture');
    });

    it('fails when a translation object carries a non-en key', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title.es = 'Lección';
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('fails when a translation slot omits en entirely', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[0].title = { es: 'Lección' };
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('fails when a friend-slug step is not in a recapSources: friend lesson', () => {
        const { rows } = parseCsv(FIXTURE_CSV);
        const config = buildCourseConfig(rows);
        config.lessons[1].recapSources = 'none';
        expect(() => assertGeneratedConfigContract(config, 'mutated')).toThrow();
    });

    it('every listed generated config satisfies the contract', () => {
        const listed = readAllowlist();
        for (const courseId of listed) {
            const file = path.join(CONFIG_DIR, `${courseId}.json`);
            const config = JSON.parse(readFileSync(file, 'utf8'));
            assertGeneratedConfigContract(config, courseId);
        }
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
        results[1].config.lessons[0].title.es = 'Lección';
        expect(() => results.forEach((r) => assertGeneratedConfigContract(r.config, r.courseId))).toThrow();
    });
});
