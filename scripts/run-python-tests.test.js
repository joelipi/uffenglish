// Verifies the Python test harness wiring (story 040, Task 4): `pretest` runs
// `test:python`, the runner prefers python3 then python, and the command exits 0.
// Uses only Node built-ins (spawnSync) — no new dependency.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-python-tests.mjs');

describe('python test harness wiring', () => {
    it('package.json runs the Python suite before vitest', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['test:python']).toBe('node scripts/run-python-tests.mjs');
        expect(pkg.scripts.pretest).toBe('npm run test:python');
    });

    it('run-python-tests.mjs tries python3 before python', () => {
        const src = fs.readFileSync(RUNNER, 'utf8');
        const py3 = src.indexOf("run('python3')");
        const py = src.indexOf("run('python')");
        expect(py3).toBeGreaterThan(-1);
        expect(py).toBeGreaterThan(-1);
        expect(py3).toBeLessThan(py);
    });

    it('npm run test:python exits 0', () => {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = spawnSync(npm, ['run', 'test:python'], { cwd: ROOT, encoding: 'utf8' });
        expect(result.status, result.stderr || result.stdout).toBe(0);
    }, 120000);
});
