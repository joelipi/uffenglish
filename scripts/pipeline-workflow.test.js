// scripts/pipeline-workflow.test.js
// Story 051, Task 2: source guard for .github/workflows/pipeline.yml. The
// orchestrating workflow owns the `render-complete` trigger and chains the three
// sheet actions as reusable workflows via `needs:`. Raw source (no comment
// stripping) and each pinned token is proven failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PIPELINE = path.join(ROOT, '.github/workflows/pipeline.yml');
const SYNC_SRT = path.join(ROOT, '.github/workflows/sync-srt.yml');
const CONFIGS = path.join(ROOT, '.github/workflows/configs.yml');

const read = (p) => readFileSync(p, 'utf8');

/** The lines of one 2-space-indented job block, so a `needs:`/`uses:` assertion
 * cannot be satisfied by a different job's line. */
function jobBlock(text, name) {
    const jobs = text.slice(text.indexOf('jobs:'));
    const lines = jobs.split('\n');
    const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
    if (start === -1) throw new Error(`pipeline.yml: job "${name}" not found`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start, end).join('\n');
}

function assertPipelineContract(text) {
    expect(text).toContain('repository_dispatch:');
    expect(text).toContain('types: [render-complete]');
    expect(text).toContain('workflow_dispatch:');
    expect((text.match(/secrets: inherit/g) || [])).toHaveLength(3);

    // Each job calls its reusable workflow and depends on the previous job.
    const srt = jobBlock(text, 'srt');
    expect(srt).toContain('uses: ./.github/workflows/sync-srt.yml');
    const translate = jobBlock(text, 'translate');
    expect(translate).toContain('uses: ./.github/workflows/translate-sheet.yml');
    expect(translate).toContain('needs: srt');
    const configs = jobBlock(text, 'configs');
    expect(configs).toContain('uses: ./.github/workflows/configs.yml');
    expect(configs).toContain('needs: translate');

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

    it('the guard can fail on each required token', () => {
        const good = read(PIPELINE);
        const required = [
            'repository_dispatch:', 'types: [render-complete]', 'workflow_dispatch:',
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
