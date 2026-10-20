// src/modules/courses/course-reference-guard.test.js
// Static guard for the course set and the browser suite's course targets.
//
// Nothing has shipped, so the course set was reduced to one path per flow
// (stories/077-one-course-path-forward). Two rules keep it that way:
//
//   1. The suite navigates only to a reference course. A spec that points at a
//      retired config proves nothing - gt2's lessons have no `steps`, so the
//      app could never load them, and every spec load timed out.
//   2. A spec that waits for the store's `configData` clears the guest gate
//      first. The guest-language modal gates the config load, so waiting for
//      `configData` before confirming the language deadlocks.
//
// The spec files are read as raw source: a guard that could not fail is worse
// than no guard (AGENTS.md).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.join(__dirname, '../../../tests');
const SPEC_FILES = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.spec.js')).sort();
const SPECS = SPEC_FILES.map((name) => ({
    name,
    source: readFileSync(path.join(TESTS_DIR, name), 'utf8'),
}));

// The one regular-flow course and the one friend course (the dev twin of the
// generated config). `wouldyourather` is the generated course the pipeline
// ships; its dev twin `wouldyourather-test` is the one the suite drives.
const REFERENCE_COURSES = ['model', 'wouldyourather-test'];

// The retired configs. `t` and `test` are too generic to match as bare words,
// so they are only checked in URL form.
const RETIRED_COURSE_IDS = ['friend', 'friendchain', 'wouldrather', 'gt2', 'test-api'];
const RETIRED_COURSE_IDS_IN_URLS = [...RETIRED_COURSE_IDS, 't', 'test'];

/** Every course URL the specs navigate to. */
function navigatedCourseUrls(source) {
    const urls = [];
    const goto = /page\.goto\(\s*'([^']+)'/g;
    let match;
    while ((match = goto.exec(source)) !== null) {
        if (match[1].startsWith('/course/')) urls.push(match[1]);
    }
    return urls;
}

describe('the browser suite targets only the reference courses', () => {
    it('every course the suite navigates to is a reference course', () => {
        for (const spec of SPECS) {
            for (const url of navigatedCourseUrls(spec.source)) {
                const courseId = url.split('/')[2];
                expect(
                    REFERENCE_COURSES,
                    `${spec.name} navigates to ${url}, which is not a reference course`
                ).toContain(courseId);
            }
        }
    });

    it('no spec points at a retired course', () => {
        for (const spec of SPECS) {
            for (const courseId of RETIRED_COURSE_IDS_IN_URLS) {
                expect(
                    spec.source,
                    `${spec.name} still points at the retired course ${courseId}`
                ).not.toContain(`/course/${courseId}/`);
            }
            for (const courseId of RETIRED_COURSE_IDS) {
                expect(
                    spec.source,
                    `${spec.name} still names the retired course ${courseId}`
                ).not.toMatch(new RegExp(`course_?[iI]d\\s*:\\s*'${courseId}'`));
            }
        }
    });
});

describe('the suite clears the guest gate before it waits for the config', () => {
    it('every spec that waits for configData clears the guest-language gate', () => {
        for (const spec of SPECS) {
            // The wait is `page.waitForFunction(() => ...configData...)`, and the
            // `configData` reference can sit AFTER a closing paren
            // (`getState()?.configData`), so the window is bounded rather than
            // "up to the first `)`".
            const waitsForConfig = /waitForFunction\([\s\S]{0,300}?\bconfigData\b/.test(spec.source)
                || /\bconfigData\b\s*&&/.test(spec.source)
                || /\bconfigData\b\s*!=\s*null/.test(spec.source);
            if (!waitsForConfig) continue;
            const clearsGate = spec.source.includes('confirmGuestLanguage(page)')
                || spec.source.includes('#guestEnglishOnlyBtn');
            expect(
                clearsGate,
                `${spec.name} waits for configData but never clears the guest-language gate, `
                + 'so the config load it waits for is gated behind the modal'
            ).toBe(true);
        }
    });
});
