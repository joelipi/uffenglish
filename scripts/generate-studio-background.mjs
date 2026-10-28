// Generate the neutral studio backdrop the operator studio composites behind
// the segmented person (stories/100).
//
// Why a generated backdrop and not a photo: the studio replaces the real room
// with a background it can also paint BEHIND the hair, so the backdrop must be
// mid-tone, low-detail and brighter behind the head — a busy or high-contrast
// image is what makes a real-time matte look like a sticker. This is the
// "virtual studio" recipe: a vertical wash, a soft key light behind the subject,
// a horizon line that grounds a seated person, and a gentle vignette.
//
// Pure Node, no image dependency: the PNG is encoded here (zlib + CRC32) so the
// committed artifact has a generator in the repo instead of being an opaque
// binary. The pixel maths is a pure function, unit-tested.
//
//   node scripts/generate-studio-background.mjs            # writes the PNG
//   node scripts/generate-studio-background.mjs --out=DIR  # elsewhere

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The committed artifact the studio resolves for a bare `studio` layer value. */
export const DEFAULT_OUT = path.join(REPO_ROOT, 'public', 'overlays', 'backgrounds', 'studio.png');

/** 9:16 at the composite's own capture size. */
export const WIDTH = 1080;
export const HEIGHT = 1920;

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const smoothstep = (edge0, edge1, x) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Low-detail studio palette. Kept mid-tone on purpose: a very light wall blows
// out light hair, a very dark one swallows dark hair.
const TOP = [92, 98, 108];
const BOTTOM = [54, 58, 66];
// Additive key light behind the head. 34/255 is deliberately not white: the
// matte's rim needs CONTRAST against the backdrop, and a blown-out patch behind
// the head is what makes light hair disappear into the background.
const KEY_LIGHT_STRENGTH = 34;
const KEY_LIGHT_COLOUR = [255, 232, 196];

/**
 * One pixel of the backdrop. Pure: (x, y) in, [r, g, b] out.
 *
 * @returns {[number, number, number]}
 */
export function studioBackdropPixel(x, y, width = WIDTH, height = HEIGHT) {
    const u = x / width;
    const v = y / height;

    // Vertical wash.
    let r = lerp(TOP[0], BOTTOM[0], v);
    let g = lerp(TOP[1], BOTTOM[1], v);
    let b = lerp(TOP[2], BOTTOM[2], v);

    // Key light behind the head (the composite anchors a face at 42% height), so
    // the silhouette edge has a lit field to cut against.
    const dx = (u - 0.5) / 0.62;
    const dy = (v - 0.38) / 0.46;
    const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) ** 2 * KEY_LIGHT_STRENGTH;
    r += (KEY_LIGHT_COLOUR[0] / 255) * glow;
    g += (KEY_LIGHT_COLOUR[1] / 255) * glow;
    b += (KEY_LIGHT_COLOUR[2] / 255) * glow;

    // Horizon: a seated person reads as floating without a floor.
    const floor = smoothstep(0.70, 0.74, v);
    r -= 10 * floor;
    g -= 10 * floor;
    b -= 10 * floor;

    // Vignette, elliptical so it follows the frame rather than the square.
    const ex = (u - 0.5) / 0.5;
    const ey = (v - 0.5) / 0.5;
    const vignette = smoothstep(0.55, 1.15, Math.sqrt(ex * ex + ey * ey));
    r -= 40 * vignette;
    g -= 40 * vignette;
    b -= 44 * vignette;

    return [clamp255(r), clamp255(g), clamp255(b)];
}

/** Raw RGB scanlines with filter byte 0 per row. */
export function studioBackdropScanlines(width = WIDTH, height = HEIGHT) {
    const rowLength = width * 3 + 1;
    const raw = Buffer.alloc(rowLength * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * rowLength;
        raw[rowStart] = 0;
        for (let x = 0; x < width; x++) {
            const [r, g, b] = studioBackdropPixel(x, y, width, height);
            const o = rowStart + 1 + x * 3;
            raw[o] = r;
            raw[o + 1] = g;
            raw[o + 2] = b;
        }
    }
    return raw;
}

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

export function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([length, typeAndData, crc]);
}

/** A complete 8-bit RGB PNG for the backdrop. */
export function studioBackdropPng(width = WIDTH, height = HEIGHT) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // colour type: truecolour (RGB)
    ihdr[10] = 0;  // deflate
    ihdr[11] = 0;  // adaptive filtering
    ihdr[12] = 0;  // no interlace
    const idat = zlib.deflateSync(studioBackdropScanlines(width, height), { level: 9 });
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Read the width/height out of a PNG's IHDR (used by the guard). */
export function readPngSize(buffer) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < signature.length; i++) {
        if (buffer[i] !== signature[i]) throw new Error('not a PNG');
    }
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('missing IHDR');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function resolveOutDir(argv = process.argv.slice(2)) {
    const flag = argv.find((a) => a.startsWith('--out='));
    if (!flag) return null;
    return path.resolve(flag.slice('--out='.length));
}

function main() {
    const outDir = resolveOutDir();
    const outPath = outDir ? path.join(outDir, 'studio.png') : DEFAULT_OUT;
    const png = studioBackdropPng();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, png);
    console.log(`[studio-bg] wrote ${path.relative(REPO_ROOT, outPath)} (${WIDTH}x${HEIGHT}, ${png.length} bytes)`);
    return 0;
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    try {
        main();
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    }
}
