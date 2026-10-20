// scripts/generate-course-index.test.js
// The recorder's course picker reads public/courses.json, which this script
// regenerates from the repo's *.source.txt files. The list must therefore
// follow the authoring surface: add a source file, the index grows.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { courseIds, runGenerateCourseIndex, COURSE_INDEX_REL } from './generate-course-index.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('courseIds', () => {
    it('lists the repo\'s source configs, in a stable order', async () => {
        const ids = await courseIds(ROOT);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
        expect([...ids].sort()).toEqual(ids);
    });

    it('picks up a new source config', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'uff-course-index-'));
        writeFileSync(path.join(dir, 'alpha.source.txt'), '{}');
        writeFileSync(path.join(dir, 'beta.source.txt'), '{}');
        writeFileSync(path.join(dir, 'not-a-course.txt'), '{}');
        expect(await courseIds(dir)).toEqual(['alpha', 'beta']);
    });
});

describe('runGenerateCourseIndex', () => {
    it('writes the course list the recorder reads', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'uff-course-index-'));
        writeFileSync(path.join(dir, 'alpha.source.txt'), '{}');
        writeFileSync(path.join(dir, 'beta.source.txt'), '{}');
        const out = path.join(dir, 'courses.json');
        const { courses, json } = await runGenerateCourseIndex({ root: dir, outPath: out, log: () => {} });
        expect(courses).toEqual(['alpha', 'beta']);
        expect(JSON.parse(json)).toEqual({ courses: ['alpha', 'beta'] });
    });

    it('the committed index matches the repo\'s sources', async () => {
        const committed = JSON.parse(readFileSync(path.join(ROOT, COURSE_INDEX_REL), 'utf8'));
        expect(committed.courses).toEqual(await courseIds(ROOT));
    });
});
