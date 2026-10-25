#!/usr/bin/env node
// Build two Twemoji-derived face overlays with genuinely transparent eye areas.
//
// Twemoji (CC-BY 4.0, Twitter — see public/overlays/TWEMOJI-ATTRIBUTION.md) ships
// its lenses/eyes as opaque paint, so the raw emoji would hide the learner's
// eyes behind flat colour. This script cuts the eye areas out:
//
// - shades-twemoji (U+1F453 eyeglasses): the lens shapes are their own <path>,
//   in the Twemoji SVG, so the lens path itself — rendered white — is used as
//   a `dest-out` mask. The cut follows the artwork exactly, and the frame rim,
//   bridge and temples survive untouched.
// - carnival-twemoji (U+1F3AD performing-arts, purple mask only): the mask's
//   eyes are painted as closed arcs, so two calibrated ellipses over the eye
//   band are used as the `dest-out` mask instead, opening real eye holes.
//
// Run: `node scripts/generate-twemoji-overlays.mjs` (needs network for the
// pinned Twemoji fetch + `sharp` from node_modules). The committed PNGs are
// what the app and the tests use — the script only re-runs to regenerate them.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'overlays', 'face');

export const TWEMOJI_VERSION = '15.0.3';
const CDN = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`;

export async function fetchTwemojiSvg(code) {
    const res = await fetch(`${CDN}/${code}.svg`);
    if (!res.ok) throw new Error(`Twemoji fetch failed: ${code} -> HTTP ${res.status}`);
    return res.text();
}

function pathElements(svg) {
    return [...svg.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]);
}

/**
 * Probes the committed PNGs use to prove the eye areas are really transparent.
 * Fractions of the image (0..1), measured from the generated output.
 */
export const TWEMOJI_EYE_PROBES = {
    'shades-twemoji': {
        eyes: [
            { fx: 0.273, fy: 0.586 },
            { fx: 0.727, fy: 0.586 },
        ],
        opaque: { fx: 0.5, fy: 0.34 },
    },
    'carnival-twemoji': {
        eyes: [
            { fx: 0.335, fy: 0.437 },
            { fx: 0.744, fy: 0.437 },
        ],
        opaque: { fx: 0.5, fy: 0.3 },
    },
};

/** U+1F453 eyeglasses -> transparent lenses, frame kept. Output: 640x640. */
export async function buildShadesTwemoji(svgText) {
    const paths = pathElements(svgText);
    if (paths.length < 2 || !paths[1].includes('#55ACEE')) {
        throw new Error('Unexpected 1f453 SVG shape: lens path not found');
    }
    const W = 640;
    const H = 640;
    const base = await sharp(Buffer.from(svgText), { density: 450 })
        .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    // The lens path, repainted white, is the exact dest-out mask.
    const lensSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${paths[1]
        .replace('fill="#55ACEE"', 'fill="white"')}</svg>`;
    const mask = await sharp(Buffer.from(lensSvg), { density: 450 })
        .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    return sharp(base).composite([{ input: mask, blend: 'dest-out' }]).png().toBuffer();
}

/** U+1F3AD purple mask only, cropped, with two eye holes punched. */
export async function buildCarnivalTwemoji(svgText) {
    const paths = pathElements(svgText);
    if (paths.length < 4 || !paths[2].includes('#CBB7EA')) {
        throw new Error('Unexpected 1f3ad SVG shape: purple mask paths not found');
    }
    // Purple mask lives at x 14..36, y ~10..36: crop to x 12..36, y 8..36.
    const VB = { x: 12, y: 8, w: 24, h: 28 };
    const W = 560;
    const H = Math.round((W * VB.h) / VB.w);
    const cropped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}">${paths[2]}${paths[3]}</svg>`;
    const base = await sharp(Buffer.from(cropped), { density: 450 })
        .resize(W, H, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    // Calibrated from the rendered eye band (see probe run in history): viewBox
    // units, converted to output pixels below.
    const scale = W / VB.w;
    const eyes = [
        { cx: 20.05, cy: 20.25, rx: 4.3, ry: 2.5 },
        { cx: 29.85, cy: 20.25, rx: 4.3, ry: 2.5 },
    ];
    const ellipses = eyes
        .map(
            (e) =>
                `<ellipse cx="${((e.cx - VB.x) * scale).toFixed(1)}" cy="${((e.cy - VB.y) * scale).toFixed(1)}" rx="${(e.rx * scale).toFixed(1)}" ry="${(e.ry * scale).toFixed(1)}"/>`,
        )
        .join('');
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g fill="white">${ellipses}</g></svg>`;
    return sharp(base).composite([{ input: Buffer.from(maskSvg), blend: 'dest-out' }]).png().toBuffer();
}

/** Raw RGBA pixel at fractional coordinates of a PNG buffer. */
export async function probePixel(pngBuffer, fx, fy) {
    const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
    const x = Math.min(info.width - 1, Math.max(0, Math.round(fx * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.round(fy * info.height)));
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], width: info.width, height: info.height, channels: info.channels };
}

async function main() {
    const shadesSvg = await fetchTwemojiSvg('1f453');
    const shades = await buildShadesTwemoji(shadesSvg);

    const maskSvg = await fetchTwemojiSvg('1f3ad');
    const carnival = await buildCarnivalTwemoji(maskSvg);

    // Prove the holes before writing anything.
    for (const [slug, buf] of [['shades-twemoji', shades], ['carnival-twemoji', carnival]]) {
        const probe = TWEMOJI_EYE_PROBES[slug];
        for (const eye of probe.eyes) {
            const px = await probePixel(buf, eye.fx, eye.fy);
            if (px.a > 24) throw new Error(`${slug}: eye at (${eye.fx}, ${eye.fy}) is not transparent (alpha ${px.a})`);
        }
        const body = await probePixel(buf, probe.opaque.fx, probe.opaque.fy);
        if (body.a < 220) throw new Error(`${slug}: body at (${probe.opaque.fx}, ${probe.opaque.fy}) is not opaque (alpha ${body.a})`);
    }
    console.log('eye holes verified transparent, bodies opaque');

    fs.writeFileSync(path.join(OUT_DIR, 'shades-twemoji.png'), shades);
    console.log(`face/shades-twemoji.png ${shades.length}B`);
    fs.writeFileSync(path.join(OUT_DIR, 'carnival-twemoji.png'), carnival);
    console.log(`face/carnival-twemoji.png ${carnival.length}B`);
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
