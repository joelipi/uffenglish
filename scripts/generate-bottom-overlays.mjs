#!/usr/bin/env node
// Bottom band overlays: one wide strip of fruit, one of vegetables, built by
// combining several Twemoji produce emoji into a single see-through PNG that
// runs along the bottom edge of the recording frame.
//
// Run: `node scripts/generate-bottom-overlays.mjs`
//
// The frame is 9:16, so a strip that is 80% of the width is exactly 15% of the
// height (0.8 × 9/16 / 0.15 = 3), which is what `BOTTOM_OVERLAY_ASPECT` pins:
// the PNG is 1200×400 and the look-controls draw it 80% wide at `anchorY`
// 0.925, i.e. its bottom edge on the frame's bottom edge.
//
// Nothing but the produce is painted: every pixel outside an emoji is fully
// transparent, so the band sits on the video without a plate behind it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROPS_DIR = path.join(REPO_ROOT, 'public', 'overlays', 'props');

export const TWEMOJI_VERSION = '15.0.3';
const CDN = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`;

export const BOTTOM_OVERLAY_WIDTH = 1200;
export const BOTTOM_OVERLAY_HEIGHT = 400;

/** Pixels of clear space under the produce, so no glyph is clipped by the edge. */
export const BOTTOM_OVERLAY_FLOOR = 6;

/**
 * One strip's composition, left to right. `height` is the item's visual height
 * in the 400 px band, `rotate` tilts it, `overlap` pulls it left over the item
 * before it (depth), and `dip` lifts it off the common floor (a raised item is
 * drawn first, so the ones in front of it cover it).
 *
 * `height` is the emoji's own artwork height after trimming its transparent
 * margin, so eyeballing the numbers is the same as eyeballing the picture: the
 * strips are meant to have a rhythm (tall/short, tilted/straight) rather than
 * read as a row of stickers.
 */
export const BOTTOM_OVERLAY_STRIPS = {
    fruits: {
        label: 'Fruits',
        labelKey: 'look_overlay_fruits_bottom',
        items: [
            // A watermelon slice is the flat base of the pile.
            { code: '1f349', name: 'watermelon', height: 265, rotate: -6, overlap: 0, dip: 0 },
            { code: '1f34c', name: 'banana', height: 240, rotate: -12, overlap: 30, dip: 26 },
            { code: '1f34e', name: 'red apple', height: 335, rotate: 0, overlap: 28, dip: 0 },
            { code: '1f347', name: 'grapes', height: 295, rotate: 8, overlap: 46, dip: 18 },
            // A strawberry in front, low and small: the pile's front row.
            { code: '1f353', name: 'strawberry', height: 215, rotate: 10, overlap: 26, dip: 0 },
        ],
    },
    veggies: {
        label: 'Veggies',
        labelKey: 'look_overlay_veggies_bottom',
        items: [
            // Corn is the wide anchor on the left, as the melon slice is for fruit.
            { code: '1f33d', name: 'ear of maize', height: 270, rotate: -8, overlap: 0, dip: 0 },
            { code: '1f955', name: 'carrot', height: 290, rotate: 8, overlap: 30, dip: 24 },
            { code: '1f966', name: 'broccoli', height: 335, rotate: 0, overlap: 30, dip: 0 },
            { code: '1fad1', name: 'bell pepper', height: 285, rotate: -6, overlap: 40, dip: 18 },
            { code: '1f345', name: 'tomato', height: 215, rotate: -9, overlap: 28, dip: 0 },
        ],
    },
    gifts: {
        label: 'Gifts',
        labelKey: 'look_overlay_gifts_bottom',
        items: [
            // The same wrapped present four times: only its size and tilt change,
            // so the band reads as several parcels piled up rather than one
            // sticker repeated.
            { code: '1f381', name: 'wrapped present', height: 285, rotate: -9, overlap: 0, dip: 0 },
            { code: '1f381', name: 'wrapped present', height: 325, rotate: 7, overlap: 22, dip: 22 },
            { code: '1f381', name: 'wrapped present', height: 295, rotate: -4, overlap: 20, dip: 0 },
            { code: '1f381', name: 'wrapped present', height: 335, rotate: 11, overlap: 24, dip: 18 },
        ],
    },
    balls: {
        label: 'Balls',
        labelKey: 'look_overlay_balls_bottom',
        items: [
            // A row of balls: round shapes read best with a little air between
            // them, so the overlaps are smaller than the produce bands can take.
            { code: '1f3c0', name: 'basketball', height: 250, rotate: -7, overlap: 0, dip: 0 },
            { code: '26bd', name: 'soccer ball', height: 285, rotate: 0, overlap: 18, dip: 22 },
            { code: '1f3c8', name: 'american football', height: 215, rotate: 14, overlap: 16, dip: 0 },
            // The yellow softball rather than the white baseball: a white ball
            // disappears against a bright recorded frame.
            { code: '1f94e', name: 'softball', height: 255, rotate: -4, overlap: 18, dip: 20 },
            { code: '1f3d0', name: 'volleyball', height: 270, rotate: 6, overlap: 20, dip: 0 },
        ],
    },
};

/** The overlay slug a strip is published under (`fruits` → `fruits-bottom`). */
export function bottomOverlaySlug(stripKey) {
    return `${stripKey}-bottom`;
}

/** The committed file name for a strip. */
export function bottomOverlayFile(stripKey) {
    return `${bottomOverlaySlug(stripKey)}.png`;
}

/** Every strip's overlay slug, in declaration order. */
export const BOTTOM_OVERLAY_SLUGS = Object.keys(BOTTOM_OVERLAY_STRIPS).map(bottomOverlaySlug);

export async function fetchTwemojiSvg(code) {
    if (svgCache.has(code)) return svgCache.get(code);
    const res = await fetch(`${CDN}/${code}.svg`);
    if (!res.ok) throw new Error(`Twemoji fetch failed: ${code} -> HTTP ${res.status}`);
    const svg = await res.text();
    svgCache.set(code, svg);
    return svg;
}

const svgCache = new Map();

/**
 * One item, rasterized at `height` px tall with its transparent margin trimmed
 * away and the tilt applied. Returns the buffer plus its placed size.
 */
export async function buildStripItem(item) {
    const svg = await fetchTwemojiSvg(item.code);
    const square = await sharp(Buffer.from(svg), { density: 450 })
        .resize(800, 800, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    // Trim first so `height` is the height of the ARTWORK, not of the 36×36 box:
    // otherwise a flat melon slice and a tall pineapple read as different sizes.
    const trimmed = await sharp(square).trim().png().toBuffer();
    const scaled = await sharp(trimmed)
        .resize({ height: Math.round(item.height), fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    const tilted = item.rotate
        ? await sharp(scaled).rotate(item.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
        : scaled;
    // Trim again after the tilt: rotating grows the axis-aligned box, and the
    // keystoning that adds is padding, not artwork.
    const placed = await sharp(tilted).trim().png().toBuffer();
    const meta = await sharp(placed).metadata();
    return { buffer: placed, width: meta.width, height: meta.height };
}

/**
 * Lay the items out on one transparent band: a straight floor with a couple of
 * raised items behind the front row, centred horizontally and overlapped by the
 * `overlap` amounts. Returns the PNG buffer.
 */
export async function buildBottomStrip(items, { width = BOTTOM_OVERLAY_WIDTH, height = BOTTOM_OVERLAY_HEIGHT, floor = BOTTOM_OVERLAY_FLOOR, margin = 8 } = {}) {
    const measure = async (scaled) => {
        const built = [];
        for (const item of scaled) {
            built.push({ item, ...(await buildStripItem(item)) });
        }
        const overlaps = built.reduce((total, entry, index) => total + (index === 0 ? 0 : Math.max(0, entry.item.overlap || 0)), 0);
        const rowWidth = built.reduce((total, entry) => total + entry.width, 0) - overlaps;
        return { built, rowWidth };
    };

    // The spec heights are the composition; if the artwork turns out wider than
    // the band, everything shrinks by one common factor so the design survives
    // an edit to any single item (and the row never gets clipped).
    const available = width - margin * 2;
    let scaled = items;
    let { built, rowWidth } = await measure(scaled);
    if (rowWidth > available) {
        const factor = available / rowWidth;
        scaled = items.map((item) => ({ ...item, height: Math.max(1, Math.round(item.height * factor)) }));
        ({ built, rowWidth } = await measure(scaled));
    }
    if (rowWidth > width) {
        throw new Error(`Strip is ${rowWidth}px wide, wider than the ${width}px band`);
    }

    const floorY = height - floor;
    let x = Math.round((width - rowWidth) / 2);
    const placements = [];
    for (const entry of built) {
        // `overlap` is this item's own pull over the one before it, so the last
        // item's pull is honoured too.
        const left = x - Math.max(0, entry.item.overlap || 0);
        const top = floorY - entry.height - Math.round(entry.item.dip || 0);
        if (left < 0 || top < 0 || left + entry.width > width || top + entry.height > height) {
            throw new Error(
                `Item ${entry.item.name} at (${left}, ${top}) ${entry.width}×${entry.height} lands outside the ${width}×${height} band`,
            );
        }
        placements.push({ input: entry.buffer, left, top, dip: entry.item.dip || 0 });
        x = left + entry.width;
    }
    // Raised items are the ones behind: paint them first so the front row covers
    // the seams where the overlaps meet.
    const ordered = placements
        .map((placement, index) => ({ ...placement, index }))
        .sort((a, b) => (b.dip - a.dip) || (a.index - b.index));

    return sharp({
        create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite(ordered.map(({ input, left, top }) => ({ input, left, top })))
        .png()
        .toBuffer();
}

/** Every item code a strip paints, in order — used by the guards. */
export function stripCodes(stripKey) {
    const strip = BOTTOM_OVERLAY_STRIPS[stripKey];
    return strip ? strip.items.map((item) => item.code) : [];
}

async function main() {
    for (const [stripKey, strip] of Object.entries(BOTTOM_OVERLAY_STRIPS)) {
        const buf = await buildBottomStrip(strip.items);
        const file = path.join(PROPS_DIR, bottomOverlayFile(stripKey));
        fs.writeFileSync(file, buf);
        const meta = await sharp(buf).metadata();
        console.log(
            `props/${bottomOverlayFile(stripKey)} ${meta.width}x${meta.height} ${buf.length}B (${strip.items.length} items: ${strip.items.map((i) => i.name).join(', ')})`,
        );
    }
    console.log('bottom overlays generated');
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
