// scripts/no-google-sheets.test.js
// Story 065, Task 7: Google Sheets is gone — repo files are the only
// lesson-authoring store. This guard asserts zero Sheets references over the
// shipped surface: no service-account/secret names, no published-CSV URLs, no
// gid literals.
//
// Scope is the shipped surface only: `*.test.js` / `test_*.py` files are
// excluded because absence-guard tests intentionally embed the forbidden
// tokens to prove they can fail (dev-only, never shipped). `stories/` is
// excluded as the historical record. Raw file text throughout (no comment
// stripping — URLs contain `//`); every assertion is proven failable by
// injecting the token into a scanned copy.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN = [
    'GOOGLE_',
    'docs.google.com/spreadsheets',
    '2PACX',
    'gid=242913338',
];

function listFiles(dir, exts) {
    const out = [];
    const walk = (d) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (exts.includes(path.extname(entry.name))) out.push(full);
        }
    };
    walk(dir);
    return out.sort();
}

function isTestFile(file) {
    const base = path.basename(file);
    return base.endsWith('.test.js') || base.endsWith('.test.mjs')
        || base.startsWith('test_') || base === 'no-google-sheets.test.js';
}

// The shipped surface: every live source file that could reach for Sheets.
function scannedFiles() {
    const files = [
        ...listFiles(path.join(ROOT, 'scripts'), ['.mjs', '.js']),
        ...listFiles(path.join(ROOT, 'scripts', 'lib'), ['.mjs', '.js']),
        path.join(ROOT, 'public', 'recorder.html'),
        ...listFiles(path.join(ROOT, 'docs', 'video-pipeline'), ['.py']),
        ...listFiles(path.join(ROOT, '.github', 'workflows'), ['.yml']),
        path.join(ROOT, 'docs', 'video-pipeline', 'authoring-sheet.md'),
        path.join(ROOT, 'docs', 'product.md'),
    ];
    return files.filter((f) => !isTestFile(f));
}

/** `file -> forbidden tokens present`, over raw text. */
function scanFile(file, text = readFileSync(file, 'utf8')) {
    return FORBIDDEN.filter((token) => text.includes(token));
}

describe('no Google Sheets references on the shipped surface', () => {
    it('scans a non-empty file set (the guard must not pass vacuously)', () => {
        const files = scannedFiles();
        expect(files.length).toBeGreaterThan(20);
        expect(files.some((f) => f.endsWith('recorder.html'))).toBe(true);
        expect(files.some((f) => f.endsWith('pipeline_lib.py'))).toBe(true);
        expect(files.some((f) => f.endsWith('authoring-sheet.md'))).toBe(true);
    });

    it('asserts zero forbidden tokens', () => {
        const hits = [];
        for (const file of scannedFiles()) {
            for (const token of scanFile(file)) {
                hits.push(`${path.relative(ROOT, file)}: ${token}`);
            }
        }
        expect(hits).toEqual([]);
    });

    it('each token trips the matcher when injected into a scanned copy', () => {
        const victim = scannedFiles().find((f) => f.endsWith(path.join('scripts', 'generate-master-csv.mjs')));
        expect(victim, 'victim file').toBeTruthy();
        const clean = readFileSync(victim, 'utf8');
        expect(scanFile(victim, clean)).toEqual([]);
        for (const token of FORBIDDEN) {
            const hits = scanFile(victim, `${clean}\n// ${token}\n`);
            expect(hits, token).toContain(token);
        }
    });
});
