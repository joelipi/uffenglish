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
// Env seam so a test can point the guard at a temp allow-list + temp configs;
// defaults to the tracked files.
const ALLOWLIST = process.env.GENERATED_CONFIGS_ALLOWLIST
    || path.join(__dirname, '../../scripts/lib/generated-configs.json');
const CONFIG_READ_DIR = process.env.GENERATED_CONFIGS_DIR || CONFIG_DIR;

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
            const file = path.join(CONFIG_READ_DIR, `${courseId}.json`);
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

    it('rejects a non-canonical recapSources, naming the course', () => {
        const results = buildCourseConfigs(parseCsv(TWO_COURSE_CSV).rows);
        results[0].config.lessons[0].recapSources = 'bogus';
        expect(() => assertGeneratedConfigContract(results[0].config, results[0].courseId)).toThrow();
    });
});

// Story 046, Task 3 AC 3: the allow-list loop must iterate N > 1 files. The real
// allow-list is empty, so drive the actual loop (`readAllowlist` + per-file
// contract) against a temp list + temp configs via the env seams — a guard over
// an empty set proves nothing (docs/learnings.md).
describe('contract guard allow-list loop (N > 1, temp seam)', () => {
    const ROOT = path.join(__dirname, '../..');
    const runLoopOver = (listPath, readDir) => {
        // Mirror the shipped `every listed generated config satisfies the
        // contract` loop exactly, against the given seam values.
        const listed = JSON.parse(readFileSync(listPath, 'utf8'));
        for (const courseId of listed) {
            const config = JSON.parse(readFileSync(path.join(readDir, `${courseId}.json`), 'utf8'));
            assertGeneratedConfigContract(config, courseId);
        }
    };

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

            // Both valid -> the loop passes over two files.
            expect(() => runLoopOver(listPath, dir)).not.toThrow();

            // Break the second listed course -> the loop must throw.
            const beta = JSON.parse(readFileSync(path.join(dir, 'beta.json'), 'utf8'));
            beta.lessons[0].recapSources = 'bogus';
            fsMod.writeFileSync(path.join(dir, 'beta.json'), JSON.stringify(beta));
            expect(() => runLoopOver(listPath, dir)).toThrow();
        } finally { fsMod.rmSync(dir, { recursive: true, force: true }); }
    });
});
