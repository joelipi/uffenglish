// scripts/bot-commit-action.test.js
// Source guard for .github/actions/bot-commit/action.yml — the shared
// commit-with-push-retry used by every bot writer. Pins the input contract,
// the push → fetch → rebase → regenerate → amend order (presence is not
// containment: order is asserted by index), and the loud failure arms.
// Raw text throughout; each pin proven failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ACTION = path.join(ROOT, '.github/actions/bot-commit/action.yml');

const read = () => readFileSync(ACTION, 'utf8');

function runBlock(text) {
    const start = text.indexOf('git config user.name');
    if (start === -1) throw new Error('bot-commit action: run block not found');
    return text.slice(start);
}

function assertActionContract(text) {
    for (const input of ['bot-name:', 'commit-message:', 'add-paths:', 'regenerate:']) {
        expect(text, input).toContain(input);
    }
    expect(text).toContain('git config user.email "11131426+joelipi@users.noreply.github.com"');
    expect(text).toContain('git commit -m "${{ inputs.commit-message }}"');
    // Fail-fast shell: an unchecked failure (bad add-paths, failed regen)
    // aborts loud instead of pushing stale content or logging a green
    // "no changes".
    expect(text).toContain('set -euo pipefail');
    expect(text).toContain('bash -c "${{ inputs.regenerate }}" || exit 1');
    // Order follows the file: initial commit, then push → fail-fast arm →
    // fetch → rebase → regenerate → amend. A reordered file (e.g. pushing a
    // stale commit without regenerating) trips the index assertions.
    const run = runBlock(text);
    const order = [
        'git commit -m "${{ inputs.commit-message }}"',
        'git push origin',
        'push failed after 3 attempts',
        'git fetch origin',
        'git rebase',
        'bash -c "${{ inputs.regenerate }}"',
        'git commit --amend --no-edit',
    ];
    let cursor = -1;
    for (const token of order) {
        const at = run.indexOf(token, cursor + 1);
        expect(at, token).toBeGreaterThan(cursor);
        cursor = at;
    }
    expect(run).toContain('rebase --abort');
    expect(run).toContain('exit 1');
    // Credentials flow via inputs only — the shared file must never carry a
    // secret value or reach for the callers' secrets context.
    expect(text).not.toContain('secrets.');
    expect(text).not.toMatch(/ghs_[A-Za-z0-9]+/);
    expect(text).not.toMatch(/github_pat_[A-Za-z0-9]+/);
}

describe('bot-commit action source guard', () => {
    it('has the input contract, ordered retry loop, and no secret values', () => {
        expect(() => assertActionContract(read())).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const good = read();
        const tokens = [
            'bot-name:', 'commit-message:', 'add-paths:', 'regenerate:',
            'set -euo pipefail', 'bash -c "${{ inputs.regenerate }}" || exit 1',
            'git commit --amend --no-edit', 'rebase --abort',
            'push failed after 3 attempts',
            'bash -c "${{ inputs.regenerate }}"',
        ];
        for (const token of tokens) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertActionContract(mutated), token).toThrow();
        }
    });

    it('reordering fetch after rebase trips the order assertion', () => {
        const good = read();
        const run = runBlock(good);
        const fetchLine = 'git fetch origin "${{ github.ref_name }}" || continue';
        const rebaseLine = 'git rebase "origin/${{ github.ref_name }}" || { git rebase --abort; exit 1; }';
        expect(run).toContain(fetchLine);
        expect(run).toContain(rebaseLine);
        const reordered = run.replace(fetchLine, 'PLACEHOLDER').replace(rebaseLine, fetchLine).replace('PLACEHOLDER', rebaseLine);
        expect(reordered).not.toBe(run);
        const mutated = good.replace(run, reordered);
        expect(() => assertActionContract(mutated)).toThrow();
    });

    it('dropping the amend trips the order assertion', () => {
        const good = read();
        const mutated = good.split('git commit --amend --no-edit').join('git commit --amend-NOT --no-edit');
        expect(mutated).not.toContain('git commit --amend --no-edit');
        expect(() => assertActionContract(mutated)).toThrow();
    });
});
