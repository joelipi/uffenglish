#!/usr/bin/env node
// Build Twemoji-derived face overlays with genuinely transparent eye areas, plus
// Twemoji-derived hat/top overlays (no transparency).
//
// Run: `node scripts/generate-twemoji-overlays.mjs`

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACE_DIR = path.join(REPO_ROOT, 'public', 'overlays', 'face');
const PROPS_DIR = path.join(REPO_ROOT, 'public', 'overlays', 'props');

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
    'alien-twemoji': {
        eyes: [
            { fx: 0.295, fy: 0.49 },
            { fx: 0.701, fy: 0.49 },
        ],
        opaque: { fx: 0.5, fy: 0.82 },
    },
    'clown-twemoji': {
        eyes: [
            { fx: 0.319, fy: 0.319 },
            { fx: 0.708, fy: 0.319 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'grinning-cat-twemoji': {
        eyes: [
            { fx: 0.333, fy: 0.403 },
            { fx: 0.667, fy: 0.403 },
        ],
        opaque: { fx: 0.5, fy: 0.8 },
    },
    'monkey-twemoji': {
        eyes: [
            { fx: 0.361, fy: 0.472 },
            { fx: 0.639, fy: 0.472 },
        ],
        opaque: { fx: 0.5, fy: 0.9 },
    },
    'dog-twemoji': {
        eyes: [
            { fx: 0.36, fy: 0.443 },
            { fx: 0.639, fy: 0.443 },
        ],
        opaque: { fx: 0.5, fy: 0.75 },
    },
    'bear-twemoji': {
        eyes: [
            { fx: 0.36, fy: 0.499 },
            { fx: 0.639, fy: 0.499 },
        ],
        opaque: { fx: 0.5, fy: 0.84 },
    },
    'grinning-twemoji': {
        eyes: [
            { fx: 0.331, fy: 0.372 },
            { fx: 0.664, fy: 0.372 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'beaming-twemoji': {
        eyes: [
            { fx: 0.361, fy: 0.428 },
            { fx: 0.639, fy: 0.428 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'joy-twemoji': {
        eyes: [
            { fx: 0.339, fy: 0.456 },
            { fx: 0.658, fy: 0.456 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'big-grin-twemoji': {
        eyes: [
            { fx: 0.319, fy: 0.347 },
            { fx: 0.681, fy: 0.347 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'sweat-twemoji': {
        eyes: [
            { fx: 0.333, fy: 0.458 },
            { fx: 0.667, fy: 0.458 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'squinting-twemoji': {
        eyes: [
            { fx: 0.286, fy: 0.433 },
            { fx: 0.711, fy: 0.433 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'wink-twemoji': {
        eyes: [
            { fx: 0.317, fy: 0.458 },
            { fx: 0.667, fy: 0.458 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'smiling-twemoji': {
        eyes: [
            { fx: 0.331, fy: 0.356 },
            { fx: 0.667, fy: 0.356 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'tongue-twemoji': {
        eyes: [
            { fx: 0.303, fy: 0.411 },
            { fx: 0.692, fy: 0.411 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
    },
    'party-twemoji': {
        eyes: [
            { fx: 0.653, fy: 0.436 },
            { fx: 0.308, fy: 0.514 },
        ],
        opaque: { fx: 0.5, fy: 0.85 },
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
    const VB = { x: 12, y: 8, w: 24, h: 28 };
    const W = 560;
    const H = Math.round((W * VB.h) / VB.w);
    const cropped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}">${paths[2]}${paths[3]}</svg>`;
    const base = await sharp(Buffer.from(cropped), { density: 450 })
        .resize(W, H, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
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

/**
 * Generic Twemoji face overlay: rasterize the emoji, then punch every dark
 * connected component whose centroid sits in the eye band. Returns the PNG
 * buffer.
 */
export async function buildFaceTwemoji(svgText, outSize = 640) {
    const W = outSize;
    const H = outSize;
    const base = await sharp(Buffer.from(svgText), { density: 450 })
        .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    // Detect dark components on a 360x360 probe grid.
    const probeSize = 360;
    const raw = await sharp(base).resize(probeSize, probeSize, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = raw;
    const visited = new Uint8Array(info.width * info.height);
    const comps = [];
    function idx(x, y) { return (y * info.width + x) * info.channels; }
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const i = idx(x, y);
            const a = data[i + 3];
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (a > 200 && lum < 90 && !visited[y * info.width + x]) {
                let minx = x, maxx = x, miny = y, maxy = y, sumx = 0, sumy = 0, count = 0;
                const stack = [[x, y]];
                visited[y * info.width + x] = 1;
                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    count++; sumx += cx; sumy += cy;
                    if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
                    if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
                    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
                        if (visited[ny * info.width + nx]) continue;
                        const j = idx(nx, ny);
                        if (data[j + 3] > 200 && (data[j] + data[j + 1] + data[j + 2]) / 3 < 90) {
                            visited[ny * info.width + nx] = 1;
                            stack.push([nx, ny]);
                        }
                    }
                }
                const cxn = sumx / count;
                const cyn = sumy / count;
                // Eye band: not too close to edges. Skip central components (nose,
                // mouth) by requiring an off-centre centroid unless the component
                // sits high in the face (true eye row).
                if (cxn > info.width * 0.2 && cxn < info.width * 0.8 &&
                    cyn > info.height * 0.30 && cyn < info.height * 0.55 &&
                    ((cxn < info.width * 0.4 || cxn > info.width * 0.6) || cyn < info.height * 0.4)) {
                    comps.push({ minx, maxx, miny, maxy, cx: cxn, cy: cyn, count });
                }
            }
        }
    }
    if (comps.length === 0) throw new Error('No eye components detected');
    // Build mask ellipses from each component's bbox with padding.
    const ellipses = comps.map((c) => {
        const scaleX = W / probeSize;
        const scaleY = H / probeSize;
        const cx = c.cx * scaleX;
        const cy = c.cy * scaleY;
        const rx = ((c.maxx - c.minx) / 2 + 3) * scaleX;
        const ry = ((c.maxy - c.miny) / 2 + 3) * scaleY;
        return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/>`;
    }).join('');
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g fill="white">${ellipses}</g></svg>`;
    return sharp(base).composite([{ input: Buffer.from(maskSvg), blend: 'dest-out' }]).png().toBuffer();
}

/** Hat/top overlay: rasterize the emoji and trim transparent borders. */
export async function buildHatTwemoji(svgText, outSize = 560) {
    const buf = await sharp(Buffer.from(svgText), { density: 450 })
        .resize(outSize, outSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    return sharp(buf).trim().png().toBuffer();
}

/** Raw RGBA pixel at fractional coordinates of a PNG buffer. */
export async function probePixel(pngBuffer, fx, fy) {
    const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
    const x = Math.min(info.width - 1, Math.max(0, Math.round(fx * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.round(fy * info.height)));
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], width: info.width, height: info.height, channels: info.channels };
}

const FACE_CODES = {
    'alien-twemoji': '1f47d',
    'clown-twemoji': '1f921',
    'grinning-cat-twemoji': '1f63a',
    'monkey-twemoji': '1f435',
    'dog-twemoji': '1f436',
    'bear-twemoji': '1f43b',
    'grinning-twemoji': '1f600',
    'beaming-twemoji': '1f601',
    'joy-twemoji': '1f602',
    'big-grin-twemoji': '1f603',
    'sweat-twemoji': '1f605',
    'squinting-twemoji': '1f606',
    'wink-twemoji': '1f609',
    'smiling-twemoji': '1f60a',
    'tongue-twemoji': '1f60b',
    'party-twemoji': '1f973',
};

const HAT_CODES = {
    'graduationcap-twemoji': '1f393',
    'tophat-twemoji': '1f3a9',
};

async function main() {
    // shades + carnival (existing)
    const shadesSvg = await fetchTwemojiSvg('1f453');
    const shades = await buildShadesTwemoji(shadesSvg);

    const maskSvg = await fetchTwemojiSvg('1f3ad');
    const carnival = await buildCarnivalTwemoji(maskSvg);

    // Verify shades/carnival
    for (const [slug, buf] of [['shades-twemoji', shades], ['carnival-twemoji', carnival]]) {
        const probe = TWEMOJI_EYE_PROBES[slug];
        for (const eye of probe.eyes) {
            const px = await probePixel(buf, eye.fx, eye.fy);
            if (px.a > 24) throw new Error(`${slug}: eye at (${eye.fx}, ${eye.fy}) is not transparent (alpha ${px.a})`);
        }
        const body = await probePixel(buf, probe.opaque.fx, probe.opaque.fy);
        if (body.a < 220) throw new Error(`${slug}: body at (${probe.opaque.fx}, ${probe.opaque.fy}) is not opaque (alpha ${body.a})`);
    }

    fs.writeFileSync(path.join(FACE_DIR, 'shades-twemoji.png'), shades);
    console.log(`face/shades-twemoji.png ${shades.length}B`);
    fs.writeFileSync(path.join(FACE_DIR, 'carnival-twemoji.png'), carnival);
    console.log(`face/carnival-twemoji.png ${carnival.length}B`);

    // New face overlays
    for (const [slug, code] of Object.entries(FACE_CODES)) {
        const svg = await fetchTwemojiSvg(code);
        const buf = await buildFaceTwemoji(svg);
        const probe = TWEMOJI_EYE_PROBES[slug];
        for (const eye of probe.eyes) {
            const px = await probePixel(buf, eye.fx, eye.fy);
            if (px.a > 24) throw new Error(`${slug}: eye at (${eye.fx}, ${eye.fy}) is not transparent (alpha ${px.a})`);
        }
        const body = await probePixel(buf, probe.opaque.fx, probe.opaque.fy);
        if (body.a < 220) throw new Error(`${slug}: body at (${probe.opaque.fx}, ${probe.opaque.fy}) is not opaque (alpha ${body.a})`);
        fs.writeFileSync(path.join(FACE_DIR, `${slug}.png`), buf);
        console.log(`face/${slug}.png ${buf.length}B`);
    }

    // Crown replacement + hats
    const crownSvg = await fetchTwemojiSvg('1f451');
    const crownBuf = await buildHatTwemoji(crownSvg);
    fs.writeFileSync(path.join(PROPS_DIR, 'crown.png'), crownBuf);
    console.log(`props/crown.png ${crownBuf.length}B`);

    for (const [slug, code] of Object.entries(HAT_CODES)) {
        const svg = await fetchTwemojiSvg(code);
        const buf = await buildHatTwemoji(svg);
        // slug -> filename: graduationcap-twemoji -> graduationcap? keep slug filename
        const filename = `${slug}.png`;
        fs.writeFileSync(path.join(PROPS_DIR, filename), buf);
        console.log(`props/${filename} ${buf.length}B`);
    }

    console.log('all overlays generated');
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
