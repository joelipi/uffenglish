// confetti-api-guard.test.js
// Upgrade-safety guard for canvas-confetti. The app relies on capabilities that
// only exist from 1.7 on (`flat`, `shapeFromPath`), so a silent downgrade or a
// rename in a future 1.x must fail here instead of at runtime.
//
// The option key set is DISCOVERED: it is built from a real plan for every
// variant (so a new option in a variant extends the guard automatically) plus
// the keys the success screen passes.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELEBRATION_VARIANTS, buildCelebrationPlan } from './step-celebration-logic.js';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const installedPackageJsonPath = require.resolve('canvas-confetti/package.json');
const installedRoot = path.dirname(installedPackageJsonPath);
const installedPackage = JSON.parse(readFileSync(installedPackageJsonPath, 'utf8'));
const librarySource = readFileSync(path.join(installedRoot, 'src/confetti.js'), 'utf8');
const moduleBuild = readFileSync(path.join(installedRoot, 'dist/confetti.module.mjs'), 'utf8');

const repoPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));

/** Inclusive minimum version comparison on a plain x.y.z string. */
function atLeast(version, minimum) {
    const [a, b, c] = version.split('.').map(Number);
    const [x, y, z] = minimum.split('.').map(Number);
    if (a !== x) return a > x;
    if (b !== y) return b > y;
    return c >= z;
}

/** The library's own defaults block, so keys not read via prop() are covered. */
function defaultsBlock() {
    const start = librarySource.indexOf('var defaults = {');
    const end = librarySource.indexOf('};', start);
    expect(start).toBeGreaterThan(-1);
    return librarySource.slice(start, end);
}

/** Every option key the app passes to the library. */
function optionKeysUsedByTheApp() {
    const keys = new Set();
    CELEBRATION_VARIANTS.forEach((_variant, index) => {
        for (const burst of buildCelebrationPlan(index, () => 0.5)) {
            Object.keys(burst.options).forEach((key) => keys.add(key));
        }
    });
    // SuccessEffects.jsx keeps its own burst; these are the keys it passes.
    ['particleCount', 'spread', 'origin'].forEach((key) => keys.add(key));
    return [...keys];
}

describe('canvas-confetti dependency', () => {
    it('declares ^1.9.4 in package.json and resolves 1.9.4 in the lockfile', () => {
        expect(repoPackage.dependencies['canvas-confetti']).toBe('^1.9.4');
        const locked = lockfile.packages['node_modules/canvas-confetti'];
        expect(locked.version).toBe('1.9.4');
        expect(locked.resolved).toContain('canvas-confetti-1.9.4.tgz');
        expect(locked.integrity).toMatch(/^sha512-/);
        expect(lockfile.packages[''].dependencies['canvas-confetti']).toBe('^1.9.4');
    });

    it('has >= 1.9.4 installed, not a stale copy', () => {
        expect(atLeast(installedPackage.version, '1.9.4'), installedPackage.version).toBe(true);
    });

    it('resolves exactly one canvas-confetti version (no hoisted second copy)', () => {
        const { status, stdout } = spawnSync('npm', ['ls', 'canvas-confetti', '--json'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 60_000,
        });
        expect(status).toBe(0);
        const versions = new Set();
        const walk = (node) => {
            if (!node) return;
            for (const [name, dependency] of Object.entries(node.dependencies || {})) {
                if (name === 'canvas-confetti' && dependency.version) versions.add(dependency.version);
                walk(dependency);
            }
        };
        walk(JSON.parse(stdout));
        expect([...versions]).toEqual(['1.9.4']);
    });
});

describe('the installed library still reads every option the app passes', () => {
    const defaults = defaultsBlock();

    it.each(optionKeysUsedByTheApp())('%s', (key) => {
        const readByFire = librarySource.includes(`prop(options, '${key}'`);
        const declaredInDefaults = new RegExp(`\\b${key}:`).test(defaults);
        expect(readByFire || declaredInDefaults, `${key} is not read by canvas-confetti`).toBe(true);
    });

    it('covers the 1.7+ capabilities the celebration needs', () => {
        const keys = optionKeysUsedByTheApp();
        expect(keys).toContain('flat');
        expect(keys).toContain('shapes');
        expect(librarySource).toContain('module.exports.shapeFromPath = shapeFromPath');
    });
});

describe('module build surface', () => {
    it('exports only default/create, so the helpers must come from the default export', () => {
        expect(moduleBuild).toContain('export default module.exports;');
        expect(moduleBuild).toContain('export var create = module.exports.create;');
        expect(moduleBuild).not.toMatch(/export var shapeFromPath/);
        expect(moduleBuild).not.toMatch(/export \{[^}]*shapeFromPath/);
    });

    it('the runner therefore reaches the helper through mod.default', () => {
        const runner = readFileSync(path.join(REPO_ROOT, 'src/modules/lesson/step-celebration.web.js'), 'utf8');
        expect(runner).toContain('mod.default');
    });
});
