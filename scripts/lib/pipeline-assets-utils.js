// scripts/lib/pipeline-assets-utils.js
// Pure planning utilities for the operator asset uploader
// (scripts/upload-pipeline-assets.mjs, story 040). All filesystem/process work
// lives in the CLI so every decision here is unit-testable with fakes.

import path from 'node:path';
import { pipelineAssetKey } from '../../src/modules/video/pipeline-keys.js';

// Directories under --assets-dir that are uploaded as pipeline assets, plus the
// CSV at the root.
export const KNOWN_ASSET_DIRS = ['fonts', 'backgrounds', 'audio', 'overlays'];
export const KNOWN_ASSET_FILES = ['video_data.csv'];

const CONTENT_TYPES = {
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.csv': 'text/csv',
    '.json': 'application/json',
};

export function contentTypeForAsset(filename) {
    const ext = path.extname(String(filename)).toLowerCase();
    return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// pipeline-assets/<posix rel path> — re-exported from the single source of
// truth in src/modules/video/pipeline-keys.js so the uploader and the Pages
// Functions cannot drift.
export { pipelineAssetKey };

/**
 * Every uploadable asset in `dir`: known top-level directories (recursively)
 * plus the known root files. Dotfiles are skipped. Entries are sorted by key.
 *
 * @param {object} fsMod minimal `fs`-like module (`readdirSync`, `statSync`)
 * @param {string} dir asset root
 * @returns {Array<{relPath: string, filePath: string, r2Key: string, contentType: string}>}
 */
export function collectAssetTargets(fsMod, dir) {
    const targets = [];

    const walk = (absDir, relDir) => {
        for (const name of fsMod.readdirSync(absDir)) {
            if (name.startsWith('.')) continue;
            const abs = path.join(absDir, name);
            const rel = relDir ? `${relDir}/${name}` : name;
            const stat = fsMod.statSync(abs);
            if (stat.isDirectory()) {
                walk(abs, rel);
                continue;
            }
            targets.push({
                relPath: rel,
                filePath: abs,
                r2Key: pipelineAssetKey(rel),
                contentType: contentTypeForAsset(name),
            });
        }
    };

    for (const name of KNOWN_ASSET_DIRS) {
        const abs = path.join(dir, name);
        try {
            if (!fsMod.statSync(abs).isDirectory()) continue;
        } catch {
            continue;
        }
        walk(abs, name);
    }

    for (const name of KNOWN_ASSET_FILES) {
        const abs = path.join(dir, name);
        try {
            if (!fsMod.statSync(abs).isFile()) continue;
        } catch {
            continue;
        }
        targets.push({
            relPath: name,
            filePath: abs,
            r2Key: pipelineAssetKey(name),
            contentType: contentTypeForAsset(name),
        });
    }

    return targets.sort((a, b) => a.r2Key.localeCompare(b.r2Key));
}
