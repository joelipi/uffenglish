// Tests for the studio backdrop generator and for the rule that keeps a
// `background` cell honest (stories/100).
//
// The pixel maths is pure, so it is asserted directly; the committed PNG is
// checked structurally (it must be a 1080×1920 PNG, not a placeholder). The
// last block walks every committed master CSV: a `background` cell that names a
// file nobody committed BLOCKS the take in the studio (by design), so a typo
// would stop the operator on that row with no clue why.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_OUT,
    HEIGHT,
    WIDTH,
    crc32,
    readPngSize,
    studioBackdropPixel,
    studioBackdropPng,
    studioBackdropScanlines,
} from './generate-studio-background.mjs';
import { parseCsv } from './lib/sheet-config-utils.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-studio-background.mjs');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

describe('studioBackdropPixel', () => {
    it('is mid-tone (never blows out or crushes)', () => {
        for (const [x, y] of [[0, 0], [WIDTH / 2, HEIGHT / 2], [WIDTH - 1, HEIGHT - 1], [WIDTH / 2, 40]]) {
            const [r, g, b] = studioBackdropPixel(x, y);
            for (const channel of [r, g, b]) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(255);
            }
            // The lit patch must stay well under white: light hair needs
            // contrast against the backdrop, not a blown-out field.
            expect(Math.max(r, g, b)).toBeLessThan(200);
        }
    });

    it('lights the field behind the head more than the corners', () => {
        const behindHead = studioBackdropPixel(WIDTH / 2, HEIGHT * 0.38);
        const corner = studioBackdropPixel(4, 4);
        expect(behindHead[0] + behindHead[1] + behindHead[2])
            .toBeGreaterThan(corner[0] + corner[1] + corner[2]);
    });

    it('is brighter at the top than at the bottom, with a floor below the horizon', () => {
        const top = studioBackdropPixel(WIDTH / 2, 2);
        const above = studioBackdropPixel(WIDTH / 2, HEIGHT * 0.68);
        const below = studioBackdropPixel(WIDTH / 2, HEIGHT * 0.78);
        expect(top[0]).toBeGreaterThan(below[0]);
        expect(above[0]).toBeGreaterThan(below[0]);
    });

    it('vignettes the frame edges', () => {
        const centre = studioBackdropPixel(WIDTH / 2, HEIGHT * 0.5);
        const edge = studioBackdropPixel(2, HEIGHT * 0.5);
        expect(edge[0]).toBeLessThan(centre[0]);
    });

    it('is deterministic', () => {
        expect(studioBackdropPixel(123, 456)).toEqual(studioBackdropPixel(123, 456));
    });
});

describe('PNG encoding', () => {
    it('matches the standard CRC32 check value', () => {
        // The published check value for "123456789" — a wrong polynomial or a
        // missing final XOR shows up immediately.
        expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
    });

    it('encodes a decodable PNG of the requested size', () => {
        const png = studioBackdropPng(24, 40);
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(readPngSize(png)).toEqual({ width: 24, height: 40 });
        // IEND is the last chunk: length(4) + "IEND"(4) + crc(4).
        expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
    });

    it('rejects a buffer that is not a PNG', () => {
        expect(() => readPngSize(Buffer.alloc(40))).toThrow(/not a PNG/);
    });

    it('writes one filter byte plus three channels per pixel', () => {
        const raw = studioBackdropScanlines(3, 2);
        expect(raw.length).toBe((3 * 3 + 1) * 2);
        expect(raw[0]).toBe(0);
        expect(raw[3 * 3 + 1]).toBe(0);
    });
});

describe('committed studio backdrop', () => {
    it('exists at the path a bare `studio` layer resolves to', () => {
        const png = fs.readFileSync(DEFAULT_OUT);
        expect(readPngSize(png)).toEqual({ width: WIDTH, height: HEIGHT });
        expect(path.relative(REPO_ROOT, DEFAULT_OUT)).toBe(
            path.join('public', 'overlays', 'backgrounds', 'studio.png')
        );
    });

    it('is regenerable by the committed script (CLI writes the same bytes)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-studio-bg-'));
        try {
            execFileSync(process.execPath, [SCRIPT, `--out=${tmp}`], { stdio: 'pipe' });
            const generated = fs.readFileSync(path.join(tmp, 'studio.png'));
            const committed = fs.readFileSync(DEFAULT_OUT);
            // The encoder is dependency-free and seeded, so the artifact is
            // reproducible: a hand-edited or stale PNG fails here.
            expect(generated.equals(committed)).toBe(true);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('every committed master CSV names a background that exists', () => {
    const csvFiles = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.master.csv'));

    it('finds the committed sheets', () => {
        expect(csvFiles.length).toBeGreaterThan(0);
    });

    it('resolves each background/foreground cell to a committed file or an https URL', () => {
        const problems = [];
        for (const file of csvFiles) {
            const { rows } = parseCsv(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8'));
            for (const row of rows) {
                for (const column of ['background', 'foreground']) {
                    const value = String(row[column] || '').trim();
                    if (!value || value === 'none' || value === 'skip') continue;
                    if (/^https:\/\//i.test(value)) continue;
                    const dir = column === 'background' ? 'backgrounds' : 'foregrounds';
                    const name = /\.(png|jpe?g|webp)$/i.test(value) ? value : `${value}.png`;
                    const target = path.join(PUBLIC_DIR, 'overlays', dir, name);
                    if (!fs.existsSync(target)) {
                        problems.push(`${file}: ${row.filename || row.video_file} → ${column}=${value} (no ${path.relative(REPO_ROOT, target)})`);
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    });
});
