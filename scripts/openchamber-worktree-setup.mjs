#!/usr/bin/env node
// Provision the machine-global OpenCode config that worktree sessions need.
//
// OpenCode only discovers project `.opencode` config from the directory its
// server was started in, so a session whose directory is a worktree never sees
// the worktree's `.opencode/agents`. Without the custom agents in the global
// config, the first prompt in a worktree dies with `UnknownError` in
// `SessionPrompt.createUserMessage` (the agent lookup resolves to undefined).
//
// This script mirrors the repo's agents into `~/.config/opencode/agents/` and
// makes sure `opencode-subagent-completion-hook` — which runs the reviewers'
// `on_complete` hooks (`peck ... commit`) — is in the global plugin list. It is
// idempotent and is run by every worktree setup so a new machine bootstraps
// itself once `npm install` has populated the repo's `node_modules`.
//
// Usage: node scripts/openchamber-worktree-setup.mjs <repo-root>
//        (or set ROOT_PROJECT_PATH)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, modify, applyEdits } from 'jsonc-parser';

const root = process.argv[2] || process.env.ROOT_PROJECT_PATH;
if (!root) {
    console.error('[openchamber-setup] missing repo root (pass as argv[2] or ROOT_PROJECT_PATH)');
    process.exit(1);
}

const PLUGIN = 'opencode-subagent-completion-hook';
const globalDir = path.join(os.homedir(), '.config', 'opencode');
const globalAgentsDir = path.join(globalDir, 'agents');
const repoAgentsDir = path.join(root, '.opencode', 'agents');

// ── Global agents ────────────────────────────────────────────────────────────
if (!fs.existsSync(repoAgentsDir)) {
    console.error(`[openchamber-setup] no agents at ${repoAgentsDir}`);
    process.exit(1);
}
fs.mkdirSync(globalAgentsDir, { recursive: true });

let copied = 0;
for (const entry of fs.readdirSync(repoAgentsDir)) {
    if (!entry.endsWith('.md')) continue;
    fs.copyFileSync(path.join(repoAgentsDir, entry), path.join(globalAgentsDir, entry));
    copied += 1;
}
console.log(`[openchamber-setup] ${copied} agent(s) -> ${globalAgentsDir}`);

// ── Global plugin ────────────────────────────────────────────────────────────
const configPath = path.join(globalDir, 'opencode.jsonc');
const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}\n';
const errors = [];
const config = parse(existing, errors, { allowTrailingComma: true, disallowComments: false }) ?? {};

if (errors.length > 0) {
    console.warn(`[openchamber-setup] ${configPath} has JSONC errors; leaving it unchanged`);
    process.exit(0);
}

const plugins = Array.isArray(config.plugin) ? config.plugin : [];
const alreadyPresent = plugins.some((name) => String(name) === PLUGIN || String(name).startsWith(`${PLUGIN}@`));

if (alreadyPresent) {
    console.log(`[openchamber-setup] plugin already in ${configPath}`);
} else {
    const edits = modify(existing, ['plugin'], [...plugins, PLUGIN], {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    fs.writeFileSync(configPath, applyEdits(existing, edits));
    console.log(`[openchamber-setup] added ${PLUGIN} to ${configPath}`);
}
