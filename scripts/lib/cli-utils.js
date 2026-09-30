// scripts/lib/cli-utils.js
// Shared process/network helpers for the R2 maintenance CLIs
// (scripts/generate-thumbnails.mjs, scripts/optimize-videos.mjs). Keeping them
// here means ffmpeg detection, work-dir safety, argument parsing, and the
// wrangler invocation cannot drift between the two pipelines.

import { execFile } from 'node:child_process';
import path from 'node:path';

export function run(bin, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve(stdout);
        });
    });
}

/**
 * Resolve a work dir from an env override or a default, rejecting any path
 * inside the repo root. `label` is the env var name used in the error message.
 */
export function resolveDirOutsideRepo(repoRoot, { envValue, defaultDir, label }) {
    const dir = envValue ? path.resolve(envValue) : defaultDir;
    const rel = path.relative(repoRoot, dir);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        throw new Error(`${label} must be outside the repo root (got ${dir})`);
    }
    return dir;
}

/**
 * Exact `--name=value` lookup. Absent returns undefined; present without a value
 * throws, so `--slug` cannot silently target nothing. `--name` bare is treated
 * as present-but-empty.
 */
export function flagValue(args, name) {
    const prefix = `${name}=`;
    const found = (args || []).find((a) => a === name || a.startsWith(prefix));
    if (!found) return undefined;
    const value = found === name ? '' : found.slice(prefix.length);
    if (!value) throw new Error(`${name} requires a value (${name}=<value>)`);
    return value;
}

export async function wranglerMajor() {
    try {
        const out = await run('npx', ['wrangler', '--version']);
        const m = /(?:wrangler\s+)?(\d+)\./.exec(out);
        return m ? parseInt(m[1], 10) : 0;
    } catch {
        return 0;
    }
}

/**
 * `wrangler r2 object put uff/<r2Key> --file <file> --content-type <type>`,
 * adding `--remote` on wrangler >=4 (which otherwise targets the local R2
 * emulator; wrangler 3.x is remote-only and rejects the flag).
 */
export async function uploadObjectToR2({ r2Key, file, contentType, remoteArg = null }) {
    const args = ['wrangler', 'r2', 'object', 'put'];
    if (remoteArg) args.push(remoteArg);
    args.push(r2Key, '--file', file, '--content-type', contentType);
    await run('npx', args);
}

export async function ensureFfmpeg() {
    try {
        await run('ffmpeg', ['-version']);
        await run('ffprobe', ['-version']);
    } catch {
        console.error('ERROR: ffmpeg and ffprobe are required on PATH.\n  Install:  sudo apt-get install -y ffmpeg   (macOS: brew install ffmpeg)');
        process.exit(1);
    }
}
