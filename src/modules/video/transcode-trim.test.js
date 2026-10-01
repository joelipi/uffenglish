// src/modules/video/transcode-trim.test.js
// Source guard for the per-segment range trim (stories/035). The WebCodecs
// Conversion path needs a real browser, so the contract is asserted as text:
// transcodeRangeToMp4 must trim via Conversion + BlobSource and fail as
// webcodecs-unavailable so the export falls back to the re-render path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'transcode.web.js'), 'utf8');

describe('transcode.web.js range trim', () => {
    const start = source.indexOf('export async function transcodeRangeToMp4');
    const end = source.indexOf('export async function uploadWebmToCloudinary');
    const fn = source.slice(start, end);

    it('exports transcodeRangeToMp4(sourceBlob, startSec, endSec)', () => {
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(fn).toMatch(/transcodeRangeToMp4\(sourceBlob, startSec, endSec\)/);
    });

    it('trims via Conversion + BlobSource', () => {
        expect(fn).toMatch(/Conversion\.init\(/);
        expect(fn).toMatch(/trim:\s*\{/);
        expect(fn).toMatch(/new BlobSource\(/);
    });

    it('fails as webcodecs-unavailable and emits an mp4', () => {
        expect(fn).toMatch(/webcodecs-unavailable/);
        expect(fn).toMatch(/Mp4OutputFormat/);
        expect(fn).toMatch(/type: 'video\/mp4'/);
    });
});
