// Fail the build when `dist/` is a DEVELOPMENT bundle (stories/096).
//
// Twice a preview was deployed from a dev-mode Vite build. In dev,
// `getPermanentVideoUrl` returns the relative `/assets/videos/<slug>.mp4`; Pages
// answers unknown paths with the SPA shell, so every clip fails to demux and the
// app reads as "the simple video is not loading". Vite dead-code-eliminates the
// production branch in that artifact, so the only reliable signal is an ABSENCE:
// the chunk has no `https://r2.ultrafastfluency.com/assets/videos/` string and
// does contain the relative `assets/videos/${` template.
//
// Pure rules + a thin CLI, so the check is testable against fixture directories
// and can never run during an import (AGENTS.md: importable scripts guard main).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The marker a PRODUCTION bundle must carry (videos resolve to R2). */
export const REQUIRED_MARKER = 'https://r2.ultrafastfluency.com/assets/videos/';

/** The marker that means the bundle was built in dev (videos resolve relatively). */
export const FORBIDDEN_MARKER = 'assets/videos/${';

/** The entry chunk `index.html` must reference. */
export const MAIN_CHUNK_PATTERN = /assets\/main-[A-Za-z0-9_-]+\.js/;

/**
 * The operator studio's looks bundle (stories/100), emitted at a STABLE path
 * because the static page cannot know a content hash. Missing it means the
 * studio silently falls back to recording the raw camera.
 */
export const LOOKS_BUNDLE_REL = 'recorder-looks.js';

/**
 * Inspect a built `dist/` and report whether it is a production artifact.
 *
 * @param {object} deps
 * @param {string} deps.distDir
 * @param {(file: string, encoding: string) => string} [deps.readFileSync]
 * @returns {{ ok: boolean, problems: string[], chunk: string|null }}
 */
export function verifyBuildArtifact({
    distDir,
    readFileSync = (file, encoding) => fs.readFileSync(file, encoding),
} = {}) {
    const problems = [];
    if (!distDir) return { ok: false, problems: ['no dist directory given'], chunk: null };

    const indexPath = path.join(distDir, 'index.html');
    let indexHtml = null;
    try {
        indexHtml = readFileSync(indexPath, 'utf8');
    } catch (error) {
        return { ok: false, problems: [`missing ${path.relative(process.cwd(), indexPath) || indexPath} — run the build first`], chunk: null };
    }

    const match = String(indexHtml).match(MAIN_CHUNK_PATTERN);
    if (!match) {
        return { ok: false, problems: ['index.html references no assets/main-<hash>.js chunk'], chunk: null };
    }
    const chunkName = match[0];
    const chunkPath = path.join(distDir, chunkName);

    let chunk = null;
    try {
        chunk = readFileSync(chunkPath, 'utf8');
    } catch (error) {
        problems.push(`index.html references ${chunkName} but it cannot be read`);
        return { ok: false, problems, chunk: chunkName };
    }

    if (!String(chunk).includes(REQUIRED_MARKER)) {
        problems.push(`the main chunk has no "${REQUIRED_MARKER}" — videos would resolve to the deploy's own origin (dev-mode build)`);
    }
    if (String(chunk).includes(FORBIDDEN_MARKER)) {
        problems.push(`the main chunk contains the dev-relative "${FORBIDDEN_MARKER}" template — this is a development bundle`);
    }
    // The studio's bundle must exist, otherwise /recorder quietly records the
    // unmasked raw camera and the whole feature is invisible in production.
    if (!fs.existsSync(path.join(distDir, LOOKS_BUNDLE_REL))) {
        problems.push(`missing ${LOOKS_BUNDLE_REL} — the operator studio would record the raw camera`);
    }

    return { ok: problems.length === 0, problems, chunk: chunkName };
}

/** `--dist <dir>` (default: ./dist relative to the repo root). */
function resolveDistDir(argv = process.argv.slice(2)) {
    const flagIndex = argv.indexOf('--dist');
    if (flagIndex !== -1 && argv[flagIndex + 1]) return path.resolve(argv[flagIndex + 1]);
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'dist');
}

function main() {
    const distDir = resolveDistDir();
    const { ok, problems, chunk } = verifyBuildArtifact({ distDir });
    if (ok) {
        console.log(`[verify-build] production artifact OK (${chunk})`);
        return 0;
    }
    console.error('[verify-build] the built artifact is NOT shippable:');
    problems.forEach((problem) => console.error(`  - ${problem}`));
    console.error('  Rebuild with NODE_ENV=production (vite build) before deploying.');
    process.exitCode = 1;
    return 1;
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
