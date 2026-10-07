// scripts/translate-sheet-docs.test.js
// Story 049, Task 7: source guards for the docs the localization round-trip
// requires. Raw source (no comment stripping); each assertion is proven
// failable by mutating the real text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
} from './lib/sheet-translate-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUTHORING = path.join(ROOT, 'docs/video-pipeline/authoring-sheet.md');
const PRODUCT = path.join(ROOT, 'docs/product.md');

const read = (p) => readFileSync(p, 'utf8');

/** The story-051 "One-click pipeline" section (to the next `## ` heading), so a
 * token that also appears elsewhere in the guide cannot keep the guard green. */
function oneClickSection(text) {
    const start = text.indexOf('## One-click pipeline (automatic)');
    if (start === -1) throw new Error('authoring-sheet.md: one-click section not found');
    const rest = text.slice(start);
    const next = rest.indexOf('\n## ', 1);
    return next === -1 ? rest : rest.slice(0, next);
}

// Story 051 docs contract: the guide documents the automatic flow, the Modal
// `uff-github` secret, and that the published-CSV lag only affects manual reads.
function assertOneClickDocs({ authoring }) {
    const section = oneClickSection(authoring);
    expect(section).toContain('record → render (Modal) → SRT write-back → translate → config generation');
    expect(section).toContain('uff-github');
    expect(section).toContain('GH_DISPATCH_TOKEN');
    expect(section).toContain('GH_DISPATCH_REPO');
    expect(section).toContain('published CSV still lags');
    expect(section).toContain('manual');
    // The secret is a deploy prerequisite (only its values are optional).
    expect(section).toContain('deploy prerequisite');
}

// The docs contract: the authoring guide documents every one of the 18
// authoring localization columns (`phrase` is master-only, not in this guide)
// and the service-account share step, and the product feature list carries the
// round-trip entry.
function assertDocsContract({ authoring, product }) {
    for (const field of TRANSLATABLE_FIELDS.filter((f) => f.field !== 'phrase')) {
        for (const lang of SHEET_LANGUAGES) {
            const column = localizedColumn(field.field, lang);
            expect(authoring, column).toContain(column);
        }
    }
    expect(authoring).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(authoring).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    expect(authoring).toContain('GOOGLE_SHEET_ID');
    expect(authoring).toContain('DEEPSEEK_API_KEY');
    expect(authoring).toMatch(/Share/);
    expect(authoring).toMatch(/Editor/);
    expect(product).toContain('stories/049-translate-sheet/story.md');
    expect(product).toContain('translate-sheet.yml');
    expect(product).toMatch(/round-trip/i);
}

describe('story 049 docs contract', () => {
    it('documents the 18 localization columns + service-account setup', () => {
        expect(() => assertDocsContract({ authoring: read(AUTHORING), product: read(PRODUCT) })).not.toThrow();
    });

    it('the guard can fail on each mutation', () => {
        const authoring = read(AUTHORING);
        const product = read(PRODUCT);

        const mutated = [
            { authoring: authoring.replace('lesson_title_es', 'X'), product },
            { authoring: authoring.replace('subtitle_text_bn', 'X'), product },
            { authoring: authoring.replace('GOOGLE_SERVICE_ACCOUNT_JSON', 'X'), product },
            { authoring: authoring.replace('https://www.googleapis.com/auth/spreadsheets', 'X'), product },
            { authoring, product: product.split('stories/049-translate-sheet/story.md').join('X') },
            { authoring, product: product.replace('translate-sheet.yml', 'X') },
            { authoring, product: product.replace(/round-trip/gi, 'X') },
        ];
        for (const mutation of mutated) {
            expect(() => assertDocsContract(mutation)).toThrow();
        }
    });
});

describe('story 051 one-click docs contract', () => {
    it('documents the automatic flow, the uff-github secret and the CSV-lag caveat', () => {
        expect(() => assertOneClickDocs({ authoring: read(AUTHORING) })).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const authoring = read(AUTHORING);
        const tokens = [
            'record → render (Modal) → SRT write-back → translate → config generation',
            'uff-github', 'GH_DISPATCH_TOKEN', 'GH_DISPATCH_REPO',
            'published CSV still lags', 'manual', 'deploy prerequisite',
        ];
        for (const token of tokens) {
            const mutated = authoring.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertOneClickDocs({ authoring: mutated }), token).toThrow();
        }
    });
});

// Story 052 docs contract: the render reads the published sheet directly; the R2
// `video_data.csv` is only a post-render output, not a manual upload.
function assertSheetBackedRenderDocs({ authoring }) {
    const section = oneClickSection(authoring);
    expect(section).toContain('reads the published sheet directly');
    expect(section).toContain('no manual');
    expect(section).toContain('video_data.csv');
    expect(section).toContain('post-render output');
}

describe('story 052 sheet-backed render docs contract', () => {
    it('documents that the render reads the published sheet, not an R2 CSV upload', () => {
        expect(() => assertSheetBackedRenderDocs({ authoring: read(AUTHORING) })).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const authoring = read(AUTHORING);
        const tokens = [
            'reads the published sheet directly', 'no manual', 'video_data.csv',
            'post-render output',
        ];
        for (const token of tokens) {
            const mutated = authoring.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertSheetBackedRenderDocs({ authoring: mutated }), token).toThrow();
        }
    });
});
