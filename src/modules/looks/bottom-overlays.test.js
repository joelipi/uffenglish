// Bottom band overlays: a wide strip (produce, gifts, balls, baked goods) laid
// along the bottom edge of the recording frame. Two things have to be true for
// that to work, and each is asserted against the real artifact rather than the
// registry:
//
//  - the PNG is a 3:1 strip whose only opaque pixels are the produce (a plate
//    behind it would cover the learner's chest), and
//  - the look logic draws it 80% wide with its bottom edge ON the frame's
//    bottom edge — the generic `lower` anchor would float it mid-frame.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    isSlugValidForSlot,
    resolveSlotDrawRect,
    resolveSlotAnchor,
    resolveSlotBaseWidth,
    paintSlotOverlay,
    paintLooks,
} from './recording-looks-logic.js';
import {
    BOTTOM_OVERLAY_HEIGHT,
    BOTTOM_OVERLAY_STRIPS,
    BOTTOM_OVERLAY_WIDTH,
    bottomOverlayFile,
    bottomOverlaySlug,
    stripCodes,
} from '../../../scripts/generate-bottom-overlays.mjs';
import { TWEMOJI_EMOJIS } from '../../generated/twemoji-emojis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROPS_DIR = path.resolve(HERE, '../../../public/overlays/props');

// Derived from the generator's own strip table, so a new band is covered by
// every guard below the moment it is declared (never a hand-kept list).
const STRIP_KEYS = Object.keys(BOTTOM_OVERLAY_STRIPS);
const SLUGS = STRIP_KEYS.map(bottomOverlaySlug);

// The composite is always this shape (portrait-capture-logic), so "80% wide"
// and "bottom 15%" are exact numbers here, not approximations.
const CANVAS = { canvasWidth: 720, canvasHeight: 1280 };

function pngBuffer(slug) {
    const file = assetFileForSlug(slug);
    expect(typeof file).toBe('string');
    return fs.readFileSync(path.join(PROPS_DIR, path.basename(file)));
}

describe('bottom bands are registered as lower-slot overlays', () => {
    it('every strip lives in the lower slot with its own file', () => {
        for (const key of STRIP_KEYS) {
            expect(assetFileForSlug(bottomOverlaySlug(key))).toBe(`/overlays/props/${bottomOverlayFile(key)}`);
        }
        for (const slug of SLUGS) {
            expect(OVERLAY_LIBRARY[slug].slot).toBe('lower');
            expect(OVERLAY_LIBRARY[slug].anchor).toBe('lower');
            expect(overlaySlugsForSlot('lower')).toContain(slug);
            expect(isSlugValidForSlot(slug, 'lower')).toBe(true);
            expect(isSlugValidForSlot(slug, 'face')).toBe(false);
            expect(isSlugValidForSlot(slug, 'upper')).toBe(false);
            expect(isSlugValidForSlot(slug, 'emoji')).toBe(false);
        }
    });

    it('the picker gets a label and the option is in the Bottom tray beside the props', () => {
        for (const key of STRIP_KEYS) {
            const entry = OVERLAY_LIBRARY[bottomOverlaySlug(key)];
            expect(entry.label).toBeTruthy();
            expect(entry.labelKey).toBeTruthy();
            // the registry and the generator name the same thing
            expect(entry.label).toBe(BOTTOM_OVERLAY_STRIPS[key].label);
            expect(entry.labelKey).toBe(BOTTOM_OVERLAY_STRIPS[key].labelKey);
        }
        expect(OVERLAY_LIBRARY['fruits-bottom'].label).toBe('Fruits');
        expect(OVERLAY_LIBRARY['veggies-bottom'].label).toBe('Veggies');
        expect(OVERLAY_LIBRARY['gifts-bottom'].label).toBe('Gifts');
        // The existing lower props keep the generic anchor: an override must not
        // leak into the slot's other assets.
        expect(OVERLAY_LIBRARY.desk.baseWidth).toBeUndefined();
        expect(OVERLAY_LIBRARY.desk.anchorY).toBeUndefined();
        expect(OVERLAY_LIBRARY.frame.baseWidth).toBeUndefined();
        expect(OVERLAY_LIBRARY.frame.anchorY).toBeUndefined();
    });
});

describe('the band is 80% wide and sits on the bottom edge of the frame', () => {
    it('draws 576 × 192 at (72, 1088) on a 720 × 1280 frame', () => {
        for (const slug of SLUGS) {
            const rect = resolveSlotDrawRect({
                slot: 'lower',
                slug,
                imageWidth: BOTTOM_OVERLAY_WIDTH,
                imageHeight: BOTTOM_OVERLAY_HEIGHT,
                ...CANVAS,
            });
            // 80% of the width …
            expect(rect.dw).toBe(576);
            // … which is exactly 15% of the height, because the artwork is 3:1.
            expect(rect.dh).toBe(192);
            expect(rect.dh).toBeCloseTo(CANVAS.canvasHeight * 0.15, 6);
            // centred, with the bottom edge on the frame's bottom edge
            expect(rect.dx).toBe(72);
            expect(rect.dy + rect.dh).toBe(CANVAS.canvasHeight);
        }
    });

    it('leaves the other lower props where they were', () => {
        const rect = resolveSlotDrawRect({
            slot: 'lower',
            slug: 'desk',
            imageWidth: 800,
            imageHeight: 800,
            ...CANVAS,
        });
        // the slot default: 90% wide, centred on the lower anchor (74%)
        expect(rect.dw).toBe(648);
        expect(rect.dx + rect.dw / 2).toBeCloseTo(360, 0);
        expect(rect.dy + rect.dh / 2).toBeCloseTo(0.74 * 1280, 0);
    });

    it('a slug-less call keeps the slot default (no override leaks in)', () => {
        expect(resolveSlotBaseWidth('lower')).toBe(0.9);
        expect(resolveSlotBaseWidth('lower', 'fruits-bottom')).toBe(0.8);
        expect(resolveSlotBaseWidth('lower', 'not-a-slug')).toBe(0.9);
        expect(resolveSlotAnchor('lower', 720, 1280)).toEqual({ cx: 360, cy: 0.74 * 1280 });
        expect(resolveSlotAnchor('lower', 720, 1280, 'veggies-bottom')).toEqual({ cx: 360, cy: 0.925 * 1280 });
    });

    it('the learner can still shrink it, and it scales about its own centre', () => {
        const smaller = resolveSlotDrawRect({
            slot: 'lower',
            slug: 'fruits-bottom',
            imageWidth: BOTTOM_OVERLAY_WIDTH,
            imageHeight: BOTTOM_OVERLAY_HEIGHT,
            tuning: { dx: 0, dy: 0, scale: 0.5 },
            ...CANVAS,
        });
        expect(smaller.dw).toBe(288);
        expect(smaller.dh).toBe(96);
        expect(smaller.dx + smaller.dw / 2).toBe(360);
        expect(smaller.dy + smaller.dh / 2).toBeCloseTo(0.925 * 1280, 0);
    });

    it('paintSlotOverlay draws the band through the same rect (slug is passed)', () => {
        const calls = [];
        const ctx = { drawImage: (...args) => calls.push(args) };
        const image = { complete: true, naturalWidth: BOTTOM_OVERLAY_WIDTH, naturalHeight: BOTTOM_OVERLAY_HEIGHT };
        expect(paintSlotOverlay({ ctx, image, slot: 'lower', slug: 'fruits-bottom', ...CANVAS })).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(1)).toEqual([72, 1088, 576, 192]);
    });

    it('a full frame painted through paintLooks lands the band on the bottom edge', () => {
        const calls = [];
        const ctx = { drawImage: (...args) => calls.push(args), save() {}, restore() {} };
        const image = { complete: true, naturalWidth: BOTTOM_OVERLAY_WIDTH, naturalHeight: BOTTOM_OVERLAY_HEIGHT };
        const painted = paintLooks({
            ctx,
            ...CANVAS,
            selection: { filterId: 'none', lensId: 'none', screenId: 'none', slots: { lower: 'veggies-bottom' } },
            tuning: { lower: { dx: 0, dy: 0, scale: 1 } },
            images: { 'veggies-bottom': image },
        });
        // The slot was actually painted, with the band geometry (not the 90%
        // lower-prop default), so the slug reached the draw path.
        expect(painted.slots).toEqual(['lower']);
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(1)).toEqual([72, 1088, 576, 192]);
    });
});

describe('the committed strips are see-through wide bands of produce', () => {
    it('is a 1200 × 400 (3:1) PNG with an alpha channel', async () => {
        expect(BOTTOM_OVERLAY_WIDTH / BOTTOM_OVERLAY_HEIGHT).toBe(3);
        for (const slug of SLUGS) {
            const meta = await sharp(pngBuffer(slug)).metadata();
            expect(`${slug} ${meta.width}x${meta.height}`).toBe(`${slug} 1200x400`);
            expect(meta.hasAlpha).toBe(true);
            expect(meta.channels).toBe(4);
        }
    });

    it('has no plate behind the produce: the background is fully transparent', async () => {
        for (const slug of SLUGS) {
            const { data, info } = await sharp(pngBuffer(slug)).raw().toBuffer({ resolveWithObject: true });
            const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
            const probes = [
                [0, 0], [info.width - 1, 0], [Math.floor(info.width / 2), 0],
                [1, 1], [info.width - 2, 1],
            ];
            for (const [x, y] of probes) {
                expect(`${slug} (${x},${y}) alpha=${alphaAt(x, y)}`).toBe(`${slug} (${x},${y}) alpha=0`);
            }
            // …but the band is not empty: a real share of it is opaque artwork.
            let opaque = 0;
            for (let i = 3; i < data.length; i += info.channels) {
                if (data[i] > 200) opaque++;
            }
            const share = opaque / (info.width * info.height);
            expect(share, `${slug} opaque share`).toBeGreaterThan(0.3);
            expect(share, `${slug} opaque share`).toBeLessThan(0.7);
        }
    });

    it('ships one different picture per group (not one recoloured copy)', async () => {
        const mask = async (buf) => {
            const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
            const out = new Uint8Array(info.width * info.height);
            for (let p = 0; p < out.length; p++) out[p] = data[p * info.channels + 3] > 200 ? 1 : 0;
            return out;
        };
        const masks = new Map();
        for (const slug of SLUGS) masks.set(slug, await mask(pngBuffer(slug)));
        for (let i = 0; i < SLUGS.length; i++) {
            for (let j = i + 1; j < SLUGS.length; j++) {
                const [a, b] = [masks.get(SLUGS[i]), masks.get(SLUGS[j])];
                let differing = 0;
                for (let p = 0; p < a.length; p++) if (a[p] !== b[p]) differing++;
                expect(differing / a.length, `${SLUGS[i]} vs ${SLUGS[j]}`).toBeGreaterThan(0.1);
            }
        }
    });
});

describe('the compositions combine real emoji from the library', () => {
    it('paints at least four items per strip, every code a real Twemoji', () => {
        const known = new Set(TWEMOJI_EMOJIS.map((emoji) => emoji.code));
        for (const key of STRIP_KEYS) {
            const codes = stripCodes(key);
            expect(codes.length, key).toBeGreaterThanOrEqual(4);
            for (const code of codes) {
                expect(known.has(code), `${key} uses ${code}, which is not in the Twemoji collection`).toBe(true);
            }
        }
    });

    it('no emoji is shared between two strips', () => {
        const seen = new Map();
        for (const key of STRIP_KEYS) {
            for (const code of new Set(stripCodes(key))) {
                expect(seen.has(code), `${code} is in both ${seen.get(code)} and ${key}`).toBe(false);
                seen.set(code, key);
            }
        }
    });

    it('the gift band is the same wrapped present four times, varied rather than stamped', () => {
        const codes = stripCodes('gifts');
        expect(codes).toEqual(['1f381', '1f381', '1f381', '1f381']);
        // A repeated emoji still reads as a pile: no two parcels are placed the
        // same way.
        const poses = new Set(
            BOTTOM_OVERLAY_STRIPS.gifts.items.map((item) => `${item.height}/${item.rotate}/${item.dip}`),
        );
        expect(poses.size).toBe(codes.length);
    });

    it('gives every item a composed position (height, tilt, overlap)', () => {
        for (const strip of Object.values(BOTTOM_OVERLAY_STRIPS)) {
            for (const item of strip.items) {
                expect(item.name).toBeTruthy();
                expect(item.height).toBeGreaterThan(0);
                expect(Number.isFinite(item.rotate)).toBe(true);
                expect(item.overlap).toBeGreaterThanOrEqual(0);
                expect(item.dip).toBeGreaterThanOrEqual(0);
            }
            expect(strip.label).toBeTruthy();
        }
    });
});
