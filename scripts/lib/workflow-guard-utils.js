// scripts/lib/workflow-guard-utils.js
// Shared slicing helpers for the `.github/workflows/*.yml` source guards, so the
// "slice to the specific block" rule (AGENTS.md) lives in one place and cannot
// drift between test files. Raw-source only; no YAML parsing.

/** The top-level `concurrency:` block, up to the next column-0 key. */
export function concurrencyBlock(text, label = 'workflow') {
    const start = text.indexOf('concurrency:');
    if (start === -1) throw new Error(`${label}: concurrency block not found`);
    const rest = text.slice(start);
    const next = /\n(?=\S)/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

/** The lines of one 2-space-indented job block (from `  <name>:` to the next
 * job key), so a `needs:`/`uses:`/`secrets:` assertion cannot be satisfied by a
 * different job's line. */
export function jobBlock(text, name, label = 'workflow') {
    const jobsIndex = text.indexOf('jobs:');
    if (jobsIndex === -1) throw new Error(`${label}: jobs not found`);
    const lines = text.slice(jobsIndex).split('\n');
    const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
    if (start === -1) throw new Error(`${label}: job "${name}" not found`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start, end).join('\n');
}

/** The lines of one `- name:` step block (from `- name: <name>` to the next
 * sibling step or the end of the steps list), so a `with:` assertion cannot
 * be satisfied by a different step's lines. Assumes sibling steps start with
 * `- name:`/`- uses:`/`- run:` at exactly 6 spaces (true for every guarded
 * workflow today); a step starting otherwise would merge two steps into one
 * block and its assertions would read across the boundary. */
export function stepBlock(text, name, label = 'workflow') {
    const start = text.indexOf(`- name: ${name}`);
    if (start === -1) throw new Error(`${label}: step "${name}" not found`);
    const rest = text.slice(start);
    const lines = rest.split('\n');
    // A sibling step starts a `- name:` line at the same indent; anything
    // else (including the next job key) ends the block.
    let end = lines.length;
    for (let i = 1; i < lines.length; i++) {
        if (/^      - (name|uses|run):/.test(lines[i]) || /^  [A-Za-z0-9_-]+:/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(0, end).join('\n');
}

/** The first job-level `if:` line, so a token that also appears in a commit
 * message (e.g. `[skip configs]`) is asserted only where the guard lives. */
export function ifLine(text, label = 'workflow') {
    const line = text.split('\n').find((l) => /^\s*if:/.test(l));
    if (!line) throw new Error(`${label}: job if: line not found`);
    return line;
}

/** The `on.push` trigger block, from `  push:` to the next 2-space trigger key
 * (e.g. `  workflow_dispatch:`), so a `paths-ignore:` assertion cannot be
 * satisfied by an unrelated line elsewhere in the file. */
export function pushTriggerBlock(text, label = 'workflow') {
    const start = text.indexOf('\n  push:');
    if (start === -1) throw new Error(`${label}: push trigger not found`);
    const rest = text.slice(start + 1);
    const next = /\n  \S/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}
