import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { probeClipDurationSec } from './transcode.web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PATH = path.join(__dirname, 'transcode.web.js');
const NATIVE_PATH = path.join(__dirname, 'transcode.native.jsx');

describe('probeClipDurationSec', () => {
    it('resolves to null for a missing blob', async () => {
        await expect(probeClipDurationSec(null)).resolves.toBeNull();
        await expect(probeClipDurationSec(undefined)).resolves.toBeNull();
    });

    it('resolves to null for a malformed container without throwing', async () => {
        const malformed = new Blob([new Uint8Array([0, 1, 2, 3])]);
        await expect(probeClipDurationSec(malformed)).resolves.toBeNull();
    });

    it('exports the matching native stub so the symbol stays resolvable', () => {
        const native = readFileSync(NATIVE_PATH, 'utf8');
        expect(native).toMatch(/export async function probeClipDurationSec\(\)\s*\{\s*return null;\s*\}/);

        const web = readFileSync(WEB_PATH, 'utf8');
        expect(web).toMatch(/export async function probeClipDurationSec\(blob, \{ accurate = false \} = \{\}\)/);
        expect(web).toMatch(/new BlobSource\(blob\)/);
        expect(web).toMatch(/getDurationFromMetadata\(undefined, \{ skipLiveWait: true \}\)/);
        expect(web).toMatch(/computeDuration\(undefined, \{ skipLiveWait: true \}\)/);
        expect(web).toMatch(/input\?\.dispose\(\)/);
        // Metadata-first: the cheap header read must precede the packet scan.
        expect(web.indexOf('getDurationFromMetadata')).toBeGreaterThanOrEqual(0);
        expect(web.indexOf('getDurationFromMetadata')).toBeLessThan(web.indexOf('computeDuration'));
    });
});
