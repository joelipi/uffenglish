#!/usr/bin/env node
// Verifies that every course's first-step intro slug has a poster on R2
// (assets/videos/<slug>.jpg) and an entry in the committed LQIP module. There
// are no local posters anymore: the app always fetches posters from R2.
//
// Usage: node scripts/verify-thumbnails.mjs [--remote|--strict]
//
// R2 misses are reported but non-fatal by default (a local run has no
// credentials to publish, and deploy.yml's --upload step is non-fatal). Pass
// --remote/--strict to make a missing R2 poster fail the run (CI gate).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { introTargets, posterFilename } from './lib/poster-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'src/config');
const GENERATED_PATH = path.join(ROOT, 'src/generated/poster-lqips.js');
const CDN_POSTER_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';

async function loadConfigs() {
    const files = (await fs.readdir(CONFIG_DIR))
        .filter((f) => f.endsWith('.json'))
        .sort();
    const configs = [];
    for (const file of files) {
        try {
            configs.push(JSON.parse(await fs.readFile(path.join(CONFIG_DIR, file), 'utf8')));
        } catch (e) {
            console.error(`ERROR parsing src/config/${file}: ${e.message}`);
            process.exit(1);
        }
    }
    return configs;
}

async function main() {
    const strict = process.argv.includes('--remote') || process.argv.includes('--strict');
    const targets = introTargets(await loadConfigs());
    let missing = 0;

    // Committed LQIP module — the one poster-derived artifact that stays in git.
    let moduleText = null;
    try {
        moduleText = await fs.readFile(GENERATED_PATH, 'utf8');
    } catch {
        console.error('MISSING src/generated/poster-lqips.js — run `node scripts/generate-thumbnails.mjs`');
        missing++;
    }
    if (moduleText != null) {
        for (const { slug } of targets) {
            if (!moduleText.includes(`"${slug}"`) && !moduleText.includes(`'${slug}'`)) {
                console.error(`MISSING LQIP for ${slug}`);
                missing++;
            }
        }
    }

    // R2 state (posters are R2-only).
    for (const { slug } of targets) {
        const url = `${CDN_POSTER_BASE}${posterFilename(slug)}`;
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) {
                const line = `R2 missing ${slug}: HTTP ${res.status} (${url})`;
                if (strict) { console.error(line); missing++; } else { console.warn(`WARN ${line}`); }
            }
        } catch (e) {
            const line = `R2 fetch failed ${slug}: ${e.message}`;
            if (strict) { console.error(line); missing++; } else { console.warn(`WARN ${line}`); }
        }
    }

    if (missing) {
        console.error(`verify failed: ${missing} issue(s). Run \`node scripts/generate-thumbnails.mjs\` then \`--upload\`.`);
        process.exit(1);
    }
    console.log(`verify OK: ${targets.length} intro slugs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
