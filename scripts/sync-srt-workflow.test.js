// scripts/sync-srt-workflow.test.js
// Story 050, Task 5: source guard for .github/workflows/sync-srt.yml. The Action
// writes the pipeline-computed srt column into the operator's sheet (not the
// repo), so this pins its shape and absences and proves each pinned token is the
// detection surface.
//
// Lives under scripts/ so the src/** recorder-page scanner is unaffected.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/sync-srt.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

function assertSyncWorkflowContract(text) {
    // Triggers: manual + the accepted (not yet wired) render-complete dispatch.
    expect(text).toContain('workflow_dispatch:');
    expect(text).toContain('repository_dispatch:');
    expect(text).toContain('render-complete');
    // Cloudflare R2 download credentials + the service account + sheet id.
    expect(text).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(text).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(text).toContain('secrets.GOOGLE_SERVICE_ACCOUNT_JSON');
    expect(text).toContain('vars.GOOGLE_SHEET_ID');
    expect(text).toContain('secrets.GOOGLE_SHEET_ID');
    expect(text).toContain('node scripts/write-srt-to-sheet.mjs');
    // Absences: no repo write path, no push-capable bot token.
    expect(text).not.toContain('GH_NEW_TOKEN');
    expect(text).not.toContain('git commit');
    expect(text).not.toContain('git push');
}

describe('sync-srt.yml source guard', () => {
    it('has the required shape and absences', () => {
        expect(() => assertSyncWorkflowContract(read())).not.toThrow();
    });

    it('the guard can fail on each required token', () => {
        const good = read();
        const required = [
            'workflow_dispatch:', 'repository_dispatch:', 'render-complete',
            'secrets.CLOUDFLARE_API_TOKEN', 'secrets.CLOUDFLARE_ACCOUNT_ID',
            'secrets.GOOGLE_SERVICE_ACCOUNT_JSON', 'vars.GOOGLE_SHEET_ID',
            'secrets.GOOGLE_SHEET_ID', 'node scripts/write-srt-to-sheet.mjs',
        ];
        for (const token of required) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertSyncWorkflowContract(mutated), token).toThrow();
        }
    });

    it('re-adding a repo write path trips the absences', () => {
        const good = read();
        for (const injected of [
            '\n      - run: git commit -m x\n',
            '\n      - run: git push origin HEAD\n',
            '\n      - run: echo ${{ secrets.GH_NEW_TOKEN }}\n',
        ]) {
            expect(() => assertSyncWorkflowContract(good + injected), injected).toThrow();
        }
    });

    it('never echoes or redirects the service-account key', () => {
        const text = read();
        expect(text).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        expect(text).not.toMatch(/echo[^\n]*GOOGLE_SERVICE_ACCOUNT_JSON/);
        expect(text).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON[^\n]*>/);
    });
});
