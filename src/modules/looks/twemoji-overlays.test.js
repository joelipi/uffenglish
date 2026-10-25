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
