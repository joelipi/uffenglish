// src/config/course-tags.test.js
// Every course config carries a course-level `tags` array, so the tag data the
// app reads is present on every course (not just the two that shipped with
// tags). The set of config files is DISCOVERED from the directory, so a new
// config that forgets its tags fails this guard instead of escaping it.
//
// The four course tags under test (`travel`, `family`, `music`, `sports`) are
// spread one per config: a filter by tag must select exactly one course, which
// is what makes them useful as test data.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { strings } from '../data/strings.js';
import { courseTagStringKey } from '../modules/courses/course-tag-labels.js';
import { EXCLUDED_FRIEND_COURSE_IDS } from '../modules/courses/friend-courses-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This test lives in src/config, so the config directory IS __dirname.
const CONFIG_DIR = __dirname;
const CONFIG_FILES = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json')).sort();

// The course tags the test data covers, one per LISTED course. The dev twin
// (wouldyourather-test.json) is excluded from the listings - the app filters
// it out, so it must not take part in the uniqueness rule either.
const REQUIRED_TAGS = ['food', 'preferences'];

function loadConfig(name) {
    return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

/**
 * The course-level tag contract for one config.
 * @param {object} config - the parsed course config
 * @param {string} name - the config file name (for the failure message)
 */
function assertCourseTags(config, name) {
    expect(Array.isArray(config.tags), `${name} must have a top-level tags array`).toBe(true);
    expect(config.tags.length, `${name} must carry at least one tag`).toBeGreaterThan(0);
    for (const tag of config.tags) {
        expect(typeof tag, `${name} tag must be a string`).toBe('string');
        expect(tag.trim(), `${name} tag must not be blank`).not.toBe('');
    }
    expect(new Set(config.tags).size, `${name} tags must be unique`).toBe(config.tags.length);
    // Course level, not lesson level: the tags belong to the course, so no
    // lesson may carry its own.
    for (const lesson of config.lessons || []) {
        expect(lesson.tags, `${name} lesson ${lesson.lessonId} must not carry tags`).toBeUndefined();
    }
}

describe('course-level tags', () => {
    it('discovers more than one config file (a guard over one file proves nothing)', () => {
        expect(CONFIG_FILES.length).toBeGreaterThan(1);
    });

    it('every course config carries course-level tags', () => {
        for (const name of CONFIG_FILES) {
            assertCourseTags(loadConfig(name), name);
        }
    });

    it('spreads the test tags one per listed config', () => {
        const owners = new Map();
        for (const name of CONFIG_FILES) {
            // The dev twin is not a listed course (the app excludes it), so
            // its tags never reach a tag page.
            if (EXCLUDED_FRIEND_COURSE_IDS.includes(name.replace(/\.json$/, ''))) continue;
            // A config without tags contributes nothing, so the assertion below
            // fails on the missing tag instead of throwing a TypeError.
            for (const tag of loadConfig(name).tags || []) {
                owners.set(tag, [...(owners.get(tag) || []), name]);
            }
        }
        for (const tag of REQUIRED_TAGS) {
            const tagged = owners.get(tag) || [];
            expect(tagged.length, `tag "${tag}" must be on exactly one config`).toBe(1);
        }
        // The tags live on different configs, so filtering by one tag selects a
        // single course.
        const files = REQUIRED_TAGS.map((tag) => (owners.get(tag) || [])[0]);
        expect(new Set(files).size).toBe(REQUIRED_TAGS.length);
    });

    it('the guard can fail: a config without tags is rejected', () => {
        expect(() => assertCourseTags({ lessons: [] }, 'no-tags.json')).toThrow(/tags array/);
    });

    it('the guard can fail: a config with a blank tag is rejected', () => {
        expect(() => assertCourseTags({ tags: ['ok', '  '], lessons: [] }, 'blank-tag.json')).toThrow(/blank/);
    });

    it('the guard can fail: lesson-level tags are rejected', () => {
        const config = { tags: ['ok'], lessons: [{ lessonId: 'a', tags: ['nope'] }] };
        expect(() => assertCourseTags(config, 'lesson-tags.json')).toThrow(/must not carry tags/);
    });
});

// A topic is data (the config's `tags`), but its NAME is copy: a learner who
// is still learning English may not know what "travel" means, so every topic
// needs a translated label in the strings table. The topics are DISCOVERED from
// the configs, so a new tag fails this guard until it is translated.
//
// The assertion reads the RAW strings table: `Strings.get()` falls back to
// English, so a dropped locale would still be truthy (AGENTS.md).
describe('every topic has a translated label', () => {
    const LOCALES = ['en', 'es', 'pt', 'fr', 'hi', 'bn'];

    it('carries every locale for every topic the configs use', () => {
        const tags = new Set();
        for (const name of CONFIG_FILES) {
            for (const tag of loadConfig(name).tags || []) tags.add(tag);
        }
        expect(tags.size).toBeGreaterThan(0);
        for (const tag of tags) {
            const key = courseTagStringKey(tag);
            const entry = strings[key];
            expect(entry, `${tag} has no label (expected the string key "${key}")`).toBeTruthy();
            for (const lang of LOCALES) {
                expect(entry[lang], `${key}/${lang}`).toBeTruthy();
            }
        }
    });
});
