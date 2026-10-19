// scripts/translate-sheet-docs.test.js
// Story 065, Task 7: source guards for the docs the repo-file authoring flow
// requires (updated from the story-049 sheet contract). Raw source (no comment
// stripping); each assertion is proven failable by mutating the real text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SHEET_LANGUAGES,
    LOCALIZATION_FIELDS,
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

// Story 065 docs contract: the guide documents the automatic flow, the Modal
// `uff-github` secret, and that only the recorder's copy lags (Pages deploy),
// never the post-render chain.
function assertOneClickDocs({ authoring }) {
    const section = oneClickSection(authoring);
    expect(section).toContain('record → render (Modal) → SRT write-back → translate → config generation');
    expect(section).toContain('uff-github');
    expect(section).toContain('GH_DISPATCH_TOKEN');
    expect(section).toContain('GH_DISPATCH_REPO');
    expect(section).toContain('no publish delay');
    expect(section).toContain('after `deploy.yml` finishes');
    expect(section).toContain('manual');
    // The secret is a deploy prerequisite (only its values are optional).
    expect(section).toContain('deploy prerequisite');
}

// The docs contract: the authoring guide documents every one of the 21
// localization columns (`phrase` is master-only, not in this guide) and the
// bot-commit + Gemini setup — and carries no Google Sheets surface at all —
// while the product feature list carries the round-trip entry.
function assertDocsContract({ authoring, product }) {
    for (const field of LOCALIZATION_FIELDS.filter((f) => f.field !== 'phrase')) {
        for (const lang of SHEET_LANGUAGES) {
            const column = localizedColumn(field.field, lang);
            expect(authoring, column).toContain(column);
        }
    }
    expect(authoring).toContain('wouldyourather.source.txt');
    expect(authoring).toContain('wouldyourather.master.csv');
    expect(authoring).toContain('translate-master-csv.mjs');
    expect(authoring).toContain('GOOGLE_API_KEY');
    expect(authoring).toContain('GH_NEW_TOKEN');
    expect(authoring).not.toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    expect(authoring).not.toContain('GOOGLE_SHEET_ID');
    expect(authoring).not.toContain('docs.google.com/spreadsheets');
    expect(authoring).not.toContain('gid=242913338');
    expect(authoring).not.toContain('2PACX');
    expect(product).toContain('stories/049-translate-sheet/story.md');
    expect(product).toContain('translate-master.yml');
    expect(product).toMatch(/round-trip/i);
}

describe('story 065 docs contract', () => {
    it('documents the 35 localization columns + bot-commit setup with no Sheets surface', () => {
        expect(() => assertDocsContract({ authoring: read(AUTHORING), product: read(PRODUCT) })).not.toThrow();
    });

    it('the guard can fail on each mutation', () => {
        const authoring = read(AUTHORING);
        const product = read(PRODUCT);

        const mutated = [
            { authoring: authoring.replace('lesson_title_es', 'X'), product },
            { authoring: authoring.replace('subtitle_text_bn', 'X'), product },
            { authoring: authoring.replace('srt_bn', 'X'), product },
            { authoring: authoring.split('GOOGLE_API_KEY').join('X'), product },
            { authoring: authoring.split('wouldyourather.master.csv').join('X'), product },
            { authoring: authoring.split('translate-master-csv.mjs').join('X'), product },
            { authoring, product: product.split('stories/049-translate-sheet/story.md').join('X') },
            { authoring, product: product.replace('translate-master.yml', 'X') },
            { authoring, product: product.replace(/round-trip/gi, 'X') },
        ];
        for (const mutation of mutated) {
            expect(() => assertDocsContract(mutation)).toThrow();
        }
    });

    it('re-adding a Google token trips the negative assertions', () => {
        const authoring = read(AUTHORING);
        for (const injected of [
            '\nGOOGLE_SERVICE_ACCOUNT_JSON=x\n',
            '\nGOOGLE_SHEET_ID=x\n',
            '\nsee docs.google.com/spreadsheets/d/x\n',
        ]) {
            expect(() => assertDocsContract({ authoring: authoring + injected, product: read(PRODUCT) }), injected)
                .toThrow();
        }
    });
});

describe('story 051 one-click docs contract', () => {
    it('documents the automatic flow, the uff-github secret and the deploy-lag caveat', () => {
        expect(() => assertOneClickDocs({ authoring: read(AUTHORING) })).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const authoring = read(AUTHORING);
        const tokens = [
            'record → render (Modal) → SRT write-back → translate → config generation',
            'uff-github', 'GH_DISPATCH_TOKEN', 'GH_DISPATCH_REPO',
            'no publish delay', 'after `deploy.yml` finishes', 'manual', 'deploy prerequisite',
        ];
        for (const token of tokens) {
            const mutated = authoring.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertOneClickDocs({ authoring: mutated }), token).toThrow();
        }
    });
});

// Story 065 render-input docs contract: the render reads the committed master
// CSV directly; the R2 `video_data.csv` is only a post-render output, not a
// manual upload.
function assertSheetBackedRenderDocs({ authoring }) {
    const section = oneClickSection(authoring);
    expect(section).toContain('reads the committed master CSV directly');
    expect(section).toContain('no manual');
    expect(section).toContain('video_data.csv');
    expect(section).toContain('post-render output');
}

describe('story 065 committed-CSV render docs contract', () => {
    it('documents that the render reads the committed CSV, not an R2 upload', () => {
        expect(() => assertSheetBackedRenderDocs({ authoring: read(AUTHORING) })).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const authoring = read(AUTHORING);
        const tokens = [
            'reads the committed master CSV directly', 'no manual', 'video_data.csv',
            'post-render output',
        ];
        for (const token of tokens) {
            const mutated = authoring.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertSheetBackedRenderDocs({ authoring: mutated }), token).toThrow();
        }
    });
});
