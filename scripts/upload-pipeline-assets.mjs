#!/usr/bin/env node
// Uploads the pipeline inputs (fonts/backgrounds/audio/overlays + video_data.csv)
// to R2 under pipeline-assets/ so the operator can change content without a
// `modal deploy` (story 040, Task 8). Dry-run by default? No — explicit:
//   node scripts/upload-pipeline-assets.mjs --assets-dir=<dir> --dry-run
//   node scripts/upload-pipeline-assets.mjs --assets-dir=<dir> --upload
// Requires wrangler creds for --upload (wrangler r2 object put).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAssetTargets } from './lib/pipeline-assets-utils.js';
import { flagValue, wranglerMajor, uploadObjectToR2 } from './lib/cli-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Upload pipeline assets (fonts/backgrounds/audio/overlays + video_data.csv) to R2.

Usage:
  node scripts/upload-pipeline-assets.mjs --assets-dir=<dir> [--dry-run|--upload]

Options:
  --assets-dir=DIR   Root holding fonts/ backgrounds/ audio/ overlays/ video_data.csv
  --dry-run          Print the plan; spawn nothing
  --upload           Push each object to R2 (uff/pipeline-assets/…)
  --help, -h         Show this help
--upload needs authenticated wrangler (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }
    const assetsDir = flagValue(args, '--assets-dir');
    if (!assetsDir) throw new Error('--assets-dir=<dir> is required');
    const dryRun = args.includes('--dry-run');
    const upload = args.includes('--upload');
    if (dryRun && upload) throw new Error('--dry-run and --upload are mutually exclusive');

    const targets = collectAssetTargets(fs, path.resolve(assetsDir));
    if (!targets.length) {
        console.log(`No pipeline assets found under ${assetsDir}`);
        return;
    }

    const remoteArg = upload && (await wranglerMajor()) >= 4 ? '--remote' : null;
    let uploaded = 0;
    for (const target of targets) {
        if (!upload) {
            console.log(`DRY ${target.r2Key}`);
            continue;
        }
        await uploadObjectToR2({
            r2Key: `uff/${target.r2Key}`,
            file: target.filePath,
            contentType: target.contentType,
            remoteArg,
        });
        console.log(`UPLOAD ${target.r2Key}`);
        uploaded++;
    }
    if (!upload) {
        console.log(`Dry run: ${targets.length} asset(s). Re-run with --upload to push.`);
    } else {
        console.log(`Uploaded ${uploaded} asset(s) to pipeline-assets/.`);
    }
}

main().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
});
