// scripts/lib/bootstrap-homepage-plugin.js
// Vite plugin: render the vendored Bootstrap 5.3.8 stylesheet into a scoped
// stylesheet under one root class (scripts/lib/bootstrap-homepage-css.js) and
// write it to src/generated/homepage-bootstrap.css. That file is committed (like
// src/generated/poster-lqips.js) so every consumer — dev server, production
// build and vitest — resolves it offline; the plugin keeps it from drifting.
//
// Runs on buildStart (dev server, build and vitest) and writes only when the
// content actually changes, so it can never loop the watcher.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
    HOMEPAGE_BOOTSTRAP_CSS_PATH,
    scopeBootstrapCss,
    readSourceBootstrapCss,
} from './bootstrap-homepage-css.js';

/**
 * Regenerate the scoped stylesheet. Returns `{ path, changed }`; a read-only or
 * unchanged file reports `changed: false`.
 */
export function writeHomepageBootstrapCss(root = process.cwd()) {
    const fullPath = path.join(root, HOMEPAGE_BOOTSTRAP_CSS_PATH);
    const scoped = scopeBootstrapCss(readSourceBootstrapCss(root));
    if (existsSync(fullPath) && readFileSync(fullPath, 'utf8') === scoped) {
        return { path: fullPath, changed: false };
    }
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, scoped);
    return { path: fullPath, changed: true };
}

/** Vite plugin shape, consumed by vite.config.js. */
export function homepageBootstrapPlugin() {
    return {
        name: 'uff-homepage-bootstrap-scope',
        enforce: 'pre',
        buildStart() {
            try {
                const { changed } = writeHomepageBootstrapCss();
                if (changed) console.log('[homepage-bootstrap] Rewrote scoped Bootstrap 5.3.8 stylesheet.');
            } catch (error) {
                console.error('[homepage-bootstrap] Failed to generate the scoped Bootstrap stylesheet:', error.message);
                throw error;
            }
        },
    };
}
