#!/usr/bin/env node
// Runs the Python pipeline test suite under whichever interpreter exists
// (python3, then python). Wired as package.json `test:python`, which `pretest`
// runs before vitest so `npm test -- --run` covers both suites (story 040).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ALL = path.join(ROOT, 'docs', 'video-pipeline', 'tests', 'run_all.py');

function run(interpreter) {
    return spawnSync(interpreter, [RUN_ALL], { stdio: 'inherit' });
}

let result = run('python3');
if (result.error) {
    result = run('python');
}
if (result.error) {
    console.error('ERROR: neither python3 nor python is available on PATH.');
    process.exit(1);
}
process.exit(result.status ?? 1);
