// scripts/pipeline-workflow.test.js
// Story 051, Task 2: source guard for .github/workflows/pipeline.yml. The
// orchestrating workflow owns the `render-complete` trigger and chains the three
// sheet actions as reusable workflows via `needs:`. Raw source (no comment
// stripping) and each pinned token is proven failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrencyBlock, jobBlock } from './lib/workflow-guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PIPELINE = path.join(ROOT, '.github/workflows/pipeline.yml');
const SYNC_SRT = path.join(ROOT, '.github/workflows/sync-srt.yml');
const CONFIGS = path.join(ROOT, '.github/workflows/configs.yml');

const read = (p) => readFileSync(p, 'utf8');

function assertPipelineContract(text) {
    expect(text).toContain('repository_dispatch:');
    expect(text).toContain('types: [render-complete]');
    expect(text).toContain('workflow_dispatch:');

    // One global group with `queue: max`: queued renders wait their turn instead
    // of GitHub cancelling the older pending run (its default single-slot policy
    // would drop whole chains, since every dispatch shares refs/heads/main).
    const conc = concurrencyBlock(text);
    expect(conc).toContain('group: pipeline');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');

    // Each job calls its reusable workflow, depends on the previous job, and
    // inherits secrets in its own block.
    const srt = jobBlock(text, 'srt');
    expect(srt).toContain('uses: ./.github/workflows/sync-srt.yml');
    expect(srt).toContain('secrets: inherit');
    const translate = jobBlock(text, 'translate');
    expect(translate).toContain('uses: ./.github/workflows/translate-sheet.yml');
    expect(translate).toContain('needs: srt');
    expect(translate).toContain('secrets: inherit');
    const configs = jobBlock(text, 'configs');
    expect(configs).toContain('uses: ./.github/workflows/configs.yml');
    expect(configs).toContain('needs: translate');
    expect(configs).toContain('secrets: inherit');

    // Delegates the repo write to configs.yml; no commit/push of its own.
    expect(text).not.toContain('git commit');
    expect(text).not.toContain('git push');
}

describe('pipeline.yml source guard', () => {
    it('has the required triggers, chaining and inherited secrets', () => {
        expect(() => assertPipelineContract(read(PIPELINE))).not.toThrow();
    });

    it('owns render-complete; sync-srt and configs no longer accept it', () => {
        expect(read(PIPELINE)).toContain('render-complete');
        expect(read(SYNC_SRT)).not.toContain('repository_dispatch');
        expect(read(CONFIGS)).not.toContain('repository_dispatch');
    });

    it('chains srt -> translate -> configs with the right needs values', () => {
        const text = read(PIPELINE);
        expect(jobBlock(text, 'translate')).toContain('needs: srt');
        expect(jobBlock(text, 'configs')).toContain('needs: translate');
        expect(jobBlock(text, 'srt')).not.toContain('needs:');
    });

    it('serializes the whole chain with queue: max, and the guard can fail', () => {
        const good = read(PIPELINE);
        expect(() => assertPipelineContract(good)).not.toThrow();
        const block = concurrencyBlock(good);
        // Downgrading queue: max to the single-pending default trips the guard.
        const noQueue = good.replace(block, block.replace('queue: max', 'queue: 1'));
        expect(noQueue).not.toBe(good);
        expect(() => assertPipelineContract(noQueue)).toThrow();
        // Removing the whole block trips it too.
        const noBlock = good.replace(block, '');
        expect(() => assertPipelineContract(noBlock)).toThrow();
    });

    it('the guard can fail on each required token', () => {
        const good = read(PIPELINE);
        const required = [
            'repository_dispatch:', 'types: [render-complete]', 'workflow_dispatch:',
            'group: pipeline', 'queue: max',
            './.github/workflows/sync-srt.yml', './.github/workflows/translate-sheet.yml',
            './.github/workflows/configs.yml', 'needs: srt', 'needs: translate',
            'secrets: inherit',
        ];
        for (const token of required) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertPipelineContract(mutated), token).toThrow();
        }
    });

    it('a wrong needs value trips the per-job guard', () => {
        const good = read(PIPELINE);
        // configs would run out of order (or twice) with the wrong dependency.
        const mutated = good.replace('needs: translate', 'needs: srt');
        expect(mutated).not.toBe(good);
        expect(() => assertPipelineContract(mutated)).toThrow();
    });

    it('re-adding a repo write path trips the absences', () => {
        const good = read(PIPELINE);
        for (const injected of [
            '\n      - run: git commit -m x\n',
            '\n      - run: git push origin HEAD\n',
        ]) {
            expect(() => assertPipelineContract(good + injected), injected).toThrow();
        }
    });
});
