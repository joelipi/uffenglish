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

// The docs contract: the authoring guide documents every one of the 15
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
    it('documents the 15 localization columns + service-account setup', () => {
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
