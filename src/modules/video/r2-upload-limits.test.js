// src/modules/video/r2-upload-limits.test.js
// Guards the single source of truth for the R2 per-object upload cap
// (stories/022-raise-r2-upload-cap-to-50mb). The Function, the client pre-check,
// and the tests must all read the same constant so they cannot drift.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MAX_R2_UPLOAD_BYTES } from './r2-upload-limits.js';
import { MAX_R2_UPLOAD_BYTES as CLIENT_MAX_R2_UPLOAD_BYTES } from './video-processor.web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('MAX_R2_UPLOAD_BYTES', () => {
    it('is 50 MB', () => {
        expect(MAX_R2_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
        expect(MAX_R2_UPLOAD_BYTES).toBe(52428800);
    });

    it('is the same value when imported from the client module', () => {
        expect(CLIENT_MAX_R2_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    });
});

describe('cap is single-sourced (no hardcoded 20 MB copies)', () => {
    it('the Function imports the shared constant', () => {
        const source = read('functions/api/upload-segment.js');
        expect(source).toContain("from '../../src/modules/video/r2-upload-limits.js'");
        expect(source).toContain('MAX_R2_UPLOAD_BYTES');
        expect(source).not.toContain('20 * 1024 * 1024');
    });

    it('the client imports and re-exports the shared constant', () => {
        const source = read('src/modules/video/video-processor.web.js');
        expect(source).toContain("import { MAX_R2_UPLOAD_BYTES } from './r2-upload-limits.js'");
        expect(source).toContain('export { MAX_R2_UPLOAD_BYTES };');
        expect(source).not.toContain('20 * 1024 * 1024');
    });

    it('the Function test imports the shared constant', () => {
        const source = read('functions/api/upload-segment.test.js');
        expect(source).toContain("from '../../src/modules/video/r2-upload-limits.js'");
        expect(source).not.toContain('20 * 1024 * 1024');
    });
});

describe('docs state the 50 MB cap', () => {
    it('docs/product.md says 50 MB and no longer 20 MB', () => {
        const source = read('docs/product.md');
        expect(source).toContain('50 MB');
        expect(source).not.toContain('20 MB');
    });

    it('agents.md says 50 MB and no longer 20 MB', () => {
        const source = read('agents.md');
        expect(source).toContain('50 MB');
        expect(source).not.toContain('20 MB');
    });
});
