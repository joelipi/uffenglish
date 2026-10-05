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
import { parseCsv, buildCourseConfig } from '../../scripts/lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '../../config');
const ALLOWLIST = path.join(__dirname, '../../scripts/lib/generated-configs.json');

const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

function readAllowlist() {
    const raw = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('generated-configs.json must be an array of courseIds');
    return raw;
}

function translationStrings(node) {
    // Every { en: ... } style object anywhere in a config is a "translation
    // object" for this contract; return them all for the en-only check.
    const found = [];
    const walk = (value) => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (value && typeof value === 'object') {
            if ('en' in value) found.push(value);
            Object.values(value).forEach(walk);
        }
    };
    walk(node);
    return found;
}

// The contract applied to one config object. Throws with a specific message on
// the first violation.
function assertGeneratedConfigContract(config, label) {
    for (const obj of translationStrings(config)) {
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
});
