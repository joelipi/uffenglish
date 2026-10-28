// Source guard for the course intro-clip docs (stories/099-course-intro-clips).
//
// The authoring guide is the only place an operator learns that a course can
// declare three reusable opener clips. Pin the section CONTENT (scoped to its
// own heading, so a token elsewhere in the guide cannot keep the guard green)
// and prove the guard can fail by mutating each pinned token.
//
// Raw source only: no comment stripping — the guide has no `//` comment grammar
// and stripping would eat nothing here, but the repository's rule is to assert
// on what actually ships.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUTHORING = path.join(ROOT, 'docs/video-pipeline/authoring-sheet.md');
const PRODUCT = path.join(ROOT, 'docs/product.md');

const read = () => readFileSync(AUTHORING, 'utf8');

/** The `## Course intro clips` section, ending at the next `## ` heading. */
function introSection(text) {
    const start = text.indexOf('## Course intro clips');
    if (start === -1) throw new Error('authoring-sheet.md: course intro clips section not found');
    const rest = text.slice(start);
    const next = rest.indexOf('\n## ', 1);
    return next === -1 ? rest : rest.slice(0, next);
}

const PINNED = [
    '"intros"',
    '"first":',
    '"respond":',
    '"ask":',
    '`-intro-first`',
    '`-intro-respond`',
    '`-intro-ask`',
    '{course}-intro-first',
    'viewAndContinue',
    'first ask branch',
    '20 words',
    'one cue per line',
    'set_role: intro',
];

function assertIntroDocs(text) {
    const section = introSection(text);
    for (const token of PINNED) expect(section, token).toContain(token);
}

describe('course intro clips are documented', () => {
    it('documents the intros block, the derived slugs, the placement and the rendered clip', () => {
        expect(() => assertIntroDocs(read())).not.toThrow();
    });

    it('can fail: removing any pinned token turns the guard red', () => {
        const good = read();
        const section = introSection(good);
        for (const token of PINNED) {
            // Mutate INSIDE the scoped section: the same token appears earlier
            // in the guide (the response-type table), and a whole-file replace
            // would hit that copy and leave the guard green.
            const mutatedSection = section.replace(token, 'SENTINEL_REMOVED');
            expect(mutatedSection, token).not.toBe(section);
            const mutated = good.replace(section, mutatedSection);
            expect(() => assertIntroDocs(mutated), token).toThrow();
        }
    });

    it('fails when the whole section is deleted (it cannot pass vacuously)', () => {
        const section = introSection(read());
        expect(() => assertIntroDocs(read().replace(section, ''))).toThrow(/section not found/);
    });

    it('records the feature in the product doc', () => {
        const product = readFileSync(PRODUCT, 'utf8');
        expect(product).toContain('Three short intro clips frame every lesson');
        expect(product).toContain('stories/099-course-intro-clips/story.md');
    });
});
