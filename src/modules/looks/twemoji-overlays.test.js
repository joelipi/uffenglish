// Twemoji-derived face overlays: the eye areas must actually be transparent.
// A mask whose "holes" are painted skin-coloured (or left opaque) would hide
// the learner's eyes — the whole point of these two assets — so this asserts
// on the committed PNG bytes, not just on the registry entries.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    isSlugValidForSlot,
} from './recording-looks-logic.js';
import { TWEMOJI_EYE_PROBES, probePixel } from '../../../scripts/generate-twemoji-overlays.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACE_DIR = path.resolve(HERE, '../../../public/overlays/face');

const SLUGS = ['carnival-twemoji', 'shades-twemoji', 'alien-twemoji', 'clown-twemoji', 'grinning-cat-twemoji', 'monkey-twemoji', 'dog-twemoji', 'bear-twemoji', 'grinning-twemoji', 'beaming-twemoji', 'joy-twemoji', 'big-grin-twemoji', 'sweat-twemoji', 'squinting-twemoji', 'smiling-twemoji', 'tongue-twemoji', 'party-twemoji', 'angry-twemoji', 'nauseated-twemoji', 'vomiting-twemoji', 'cat-twemoji', 'pig-twemoji', 'tiger-twemoji', 'fox-twemoji', 'cow-twemoji', 'panda-twemoji', 'rabbit-twemoji', 'mouse-twemoji', 'koala-twemoji', 'frog-twemoji', 'owl-twemoji', 'hamster-twemoji'];

async function loadPng(slug) {
    const file = assetFileForSlug(slug);
    expect(file).toMatch(/^\/overlays\/face\/.*\.png$/);
    return sharp(path.join(FACE_DIR, path.basename(file))).png().toBuffer();
}

describe('twemoji overlays are registered as face covers', () => {
    it('both slugs live in the face slot with distinct files', () => {
        for (const slug of SLUGS) {
            expect(OVERLAY_LIBRARY[slug].slot).toBe('face');
            expect(OVERLAY_LIBRARY[slug].anchor).toBe('face');
        }
        expect(assetFileForSlug('carnival-twemoji')).toBe('/overlays/face/carnival-twemoji.png');
        expect(assetFileForSlug('shades-twemoji')).toBe('/overlays/face/shades-twemoji.png');
        expect(overlaySlugsForSlot('face')).toEqual(expect.arrayContaining(SLUGS));
    });

    it('neither slug leaks into another slot', () => {
        for (const slug of SLUGS) {
            expect(isSlugValidForSlot(slug, 'face')).toBe(true);
            expect(isSlugValidForSlot(slug, 'upper')).toBe(false);
            expect(isSlugValidForSlot(slug, 'lower')).toBe(false);
        }
    });
});

// The full-body costume covers were split into a torso (Outfit slot) and a
// headwear piece (Top slot), and are no longer offered as a single face mask.
const COSTUME_SLUGS = ['police-officer', 'chef', 'doctor', 'firefighter', 'pilot', 'astronaut', 'farmer', 'factory-worker', 'judge', 'judge-female', 'construction-worker'];
const HAT_COSTUMES = ['police-officer', 'chef', 'doctor', 'firefighter', 'pilot', 'farmer', 'factory-worker'];

describe('split costume covers: torso in Outfit, headwear in Top', () => {
    it('registers every torso as an outfit with its own file', () => {
        for (const slug of COSTUME_SLUGS) {
            const outfit = `${slug}-outfit`;
            expect(OVERLAY_LIBRARY[outfit].slot).toBe('outfit');
            expect(assetFileForSlug(outfit)).toBe(`/overlays/face/${slug}-torso.png`);
            expect(overlaySlugsForSlot('outfit')).toContain(outfit);
        }
    });

    it('registers the headwear pieces in the Top slot', () => {
        for (const slug of HAT_COSTUMES) {
            const hat = `${slug}-hat`;
            expect(OVERLAY_LIBRARY[hat].slot).toBe('upper');
            expect(assetFileForSlug(hat)).toBe(`/overlays/props/${slug}-hat.png`);
            expect(overlaySlugsForSlot('upper')).toContain(hat);
        }
    });

    it('no longer offers the whole costume as a face mask', () => {
        for (const slug of COSTUME_SLUGS) {
            expect(OVERLAY_LIBRARY[slug]).toBeUndefined();
            expect(overlaySlugsForSlot('face')).not.toContain(slug);
        }
    });

    it('leaves the torso opaque where the uniform is', async () => {
        for (const slug of COSTUME_SLUGS) {
            const buf = await loadPng(`${slug}-outfit`);
            let bodyOpaque = false;
            for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
                for (const fy of [0.8, 0.9, 0.98]) {
                    const px = await probePixel(buf, fx, fy);
                    if (px.a >= 220) { bodyOpaque = true; break; }
                }
                if (bodyOpaque) break;
            }
            expect(bodyOpaque, `${slug} torso body`).toBe(true);
        }
    });
});

describe('twemoji overlay eye areas are transparent in the PNG bytes', () => {
    it('ships RGBA art, not opaque RGB', async () => {
        for (const slug of SLUGS) {
            const probe = TWEMOJI_EYE_PROBES[slug];
            const eye = await probePixel(await loadPng(slug), probe.eyes[0].fx, probe.eyes[0].fy);
            expect(eye.channels).toBe(4);
            expect(eye.width).toBeGreaterThan(0);
        }
    });

    it('every eye opening is transparent (alpha <= 24)', async () => {
        for (const slug of SLUGS) {
            const buf = await loadPng(slug);
            for (const eye of TWEMOJI_EYE_PROBES[slug].eyes) {
                const px = await probePixel(buf, eye.fx, eye.fy);
                expect(px.a, `${slug} eye at (${eye.fx}, ${eye.fy})`).toBeLessThanOrEqual(24);
            }
        }
    });

    it('the art around the holes stays opaque (alpha >= 220)', async () => {
        for (const slug of SLUGS) {
            const buf = await loadPng(slug);
            const probe = TWEMOJI_EYE_PROBES[slug];
            const px = await probePixel(buf, probe.opaque.fx, probe.opaque.fy);
            expect(px.a, `${slug} body at (${probe.opaque.fx}, ${probe.opaque.fy})`).toBeGreaterThanOrEqual(220);
        }
    });

    it('the probe reads real alpha: a synthetic opaque pixel fails the transparency bar', async () => {
        const opaque = await sharp({
            create: { width: 2, height: 2, channels: 4, background: { r: 49, g: 55, b: 61, alpha: 1 } },
        })
            .png()
            .toBuffer();
        const px = await probePixel(opaque, 0.5, 0.5);
        expect(px.a).toBe(255);
        expect(px.a).toBeGreaterThan(24);
    });
});

describe('split costume assets are trimmed to their art', () => {
    // The split torso/headwear PNGs used to keep the whole 640×640 costume
    // canvas with the unused area transparent, so their selection box (and the
    // drag/resize target) was far larger than the visible art and overlapped
    // other overlays. Every edge must now touch an opaque pixel.
    const PUBLIC_DIR = path.resolve(HERE, '../../../public');

    async function edgesTouchArt(slug) {
        const file = assetFileForSlug(slug);
        expect(file).toBeTruthy();
        const { data, info } = await sharp(path.join(PUBLIC_DIR, file.replace(/^\//, '')))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const alphaAt = (x, y) => data[(y * width + x) * channels + (channels - 1)];
        const rowHas = (y) => {
            for (let x = 0; x < width; x += 1) if (alphaAt(x, y) > 8) return true;
            return false;
        };
        const colHas = (x) => {
            for (let y = 0; y < height; y += 1) if (alphaAt(x, y) > 8) return true;
            return false;
        };
        return rowHas(0) && rowHas(height - 1) && colHas(0) && colHas(width - 1);
    }

    it('has no transparent margins on any torso or headwear piece', async () => {
        const slugs = [
            ...COSTUME_SLUGS.map((slug) => `${slug}-outfit`),
            ...HAT_COSTUMES.map((slug) => `${slug}-hat`),
        ];
        for (const slug of slugs) {
            expect(await edgesTouchArt(slug), `${slug} has transparent margins`).toBe(true);
        }
    });
});
