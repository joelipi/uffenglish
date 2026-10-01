// src/components/widgets/clips-uploading-warning-wiring.test.js
// Source guard for the "keep this tab open while clips upload" warning. The
// publish path needs MediaRecorder/WebCodecs and cannot run in vitest, so the
// wiring is asserted as text (same convention as the other *-wiring guards).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const buttons = read('./SuccessButtons.jsx');
const screen = read('./SuccessScreen.jsx');
const strings = read('../../data/strings.js');
const store = read('../../modules/store/store.js');

describe('clips-uploading warning wiring', () => {
    it('flags clipsPublishing around the export', () => {
        const setTrue = buttons.indexOf('setClipsPublishing(true)');
        const exportAt = buttons.indexOf('await exportSegmentsToR2(');
        const setFalse = buttons.indexOf('setClipsPublishing(false)');
        expect(setTrue).toBeGreaterThan(-1);
        expect(exportAt).toBeGreaterThan(setTrue);
        expect(setFalse).toBeGreaterThan(exportAt);
        // Cleared in a finally so a publish failure still hides the warning.
        expect(buttons).toMatch(/finally\s*\{\s*appStore\.getState\(\)\.setClipsPublishing\(false\)/);
    });

    it('renders the warning from the flag and guards beforeunload', () => {
        expect(screen).toMatch(/clipsPublishing/);
        expect(screen).toMatch(/id="clipsUploadingWarning"/);
        expect(screen).toMatch(/clips_uploading_warning/);
        expect(screen).toMatch(/window\.addEventListener\('beforeunload'/);
        expect(screen).toMatch(/window\.removeEventListener\('beforeunload'/);
    });

    it('ships the warning copy in en + hi + bn', () => {
        const block = strings.match(/'clips_uploading_warning':\s*\{([\s\S]*?)\n\s*\},/);
        expect(block).toBeTruthy();
        expect(block[1]).toMatch(/\ben:/);
        expect(block[1]).toMatch(/\bhi:/);
        expect(block[1]).toMatch(/\bbn:/);
    });

    it('exposes the store flag + setter', () => {
        expect(store).toMatch(/clipsPublishing:\s*false/);
        expect(store).toMatch(/setClipsPublishing:\s*\(publishing\)\s*=>/);
    });
});
