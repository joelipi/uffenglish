#!/usr/bin/env node
// Verifies that every course's first-step intro slug has a poster on R2
// (assets/videos/<slug>.jpg). There are no local posters: the app always
// fetches posters from R2, and the Modal render writes each slug's poster as it
// publishes the video (modal_app._publish), so CI never generates one.
//
// Usage: node scripts/verify-thumbnails.mjs
//
// This is a GATE: a missing R2 poster exits non-zero. It runs in playwright.yml;
// a credentials/R2 failure surfaces here. The app degrades to a gradient, but
// the pipeline must not silently ship without posters.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { introTargets, loadConfigs, posterFilename } from './lib/poster-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'src/config');
// POSTER_CDN_BASE is a test seam; production always uses the R2 CDN.
const CDN_POSTER_BASE =
    process.env.POSTER_CDN_BASE || 'https://r2.ultrafastfluency.com/assets/videos/';

async function main() {
    const configs = await loadConfigs(CONFIG_DIR, {
        onParseError: (file, e) => console.error(`ERROR parsing src/config/${file}: ${e.message}`),
    });
    const targets = introTargets(configs);
    let missing = 0;

    // R2 state (posters are R2-only). A miss is fatal — this script is the gate.
    for (const { slug } of targets) {
        const url = `${CDN_POSTER_BASE}${posterFilename(slug)}`;
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) {
                console.error(`R2 missing ${slug}: HTTP ${res.status} (${url})`);
                missing++;
            }
        } catch (e) {
            console.error(`R2 fetch failed ${slug}: ${e.message}`);
            missing++;
        }
    }

    if (missing) {
        console.error(`verify failed: ${missing} issue(s). Run \`node scripts/generate-thumbnails.mjs\` then \`--upload\`.`);
        process.exit(1);
    }
    console.log(`verify OK: ${targets.length} intro slugs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
