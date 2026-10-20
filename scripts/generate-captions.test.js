// scripts/generate-captions.test.js
// CLI wiring, workflow, and documentation checks for the auto-caption
// pipeline (stories/009-auto-caption-simple-videos).
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import fs, { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runCli(args) {
    return new Promise((resolve) => {
        execFile('node', [path.join(ROOT, 'scripts/generate-captions.mjs'), ...args], { cwd: ROOT }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

describe('scripts/generate-captions.mjs CLI', () => {
    it('exits 0 and prints the supported flags for --help', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('--base');
        expect(stdout).toContain('--head');
        expect(stdout).toContain('--files');
        expect(stdout).toContain('--dry-run');
    });

    it('imports buildCaptionEdits from ./lib/caption-utils.js', () => {
        const source = readFileSync(path.join(ROOT, 'scripts/generate-captions.mjs'), 'utf8');
        expect(source).toContain('buildCaptionEdits');
        expect(source).toContain("from './lib/caption-utils.js'");
    });

    it('does not construct a pull request', () => {
        const source = readFileSync(path.join(ROOT, 'scripts/generate-captions.mjs'), 'utf8');
        expect(source).not.toMatch(/gh pr create|createPullRequest|pull_request/i);
    });
});

describe('.github/workflows/captions.yml', () => {
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/captions.yml'), 'utf8');

    it('exists and contains the required wiring', () => {
        expect(workflow).toContain('push');
        expect(workflow).toContain('secrets.GH_NEW_TOKEN');
        expect(workflow).toContain('fetch-depth: 0');
        expect(workflow).toContain('GOOGLE_API_KEY');
        expect(workflow).toContain('ffmpeg');
        expect(workflow).toContain('node scripts/generate-captions.mjs');
        expect(workflow).toContain('git push');
    });

    it('commits back to the branch instead of opening a PR', () => {
        expect(workflow).not.toContain('gh pr create');
        expect(workflow).not.toContain('pull_request');
    });
});

describe('.github/scripts/captions-changed.sh', () => {
    const script = readFileSync(path.join(ROOT, '.github/scripts/captions-changed.sh'), 'utf8');

    it('exists and contains the base fallback and config pathspec', () => {
        expect(script).toContain('merge-base');
        expect(script).toContain('src/config');
    });

    // A retired course's config shows up in the diff as a DELETION. Listing it
    // made the caption generator fail on the missing file
    // (`ENOENT: … src/config/friend.json`), so a course retirement broke the
    // caption run on main.
    it('lists only the configs that still exist', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captions-changed-'));
        try {
            const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
            git('init', '-q');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'test');
            fs.mkdirSync(path.join(dir, 'src/config'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'src/config/kept.json'), '{}');
            fs.writeFileSync(path.join(dir, 'src/config/retired.json'), '{}');
            git('add', '-A');
            git('commit', '-qm', 'configs');
            const base = git('rev-parse', 'HEAD').trim();

            // Retire one config and change the other.
            fs.rmSync(path.join(dir, 'src/config/retired.json'));
            fs.writeFileSync(path.join(dir, 'src/config/kept.json'), '{"changed":true}');
            git('add', '-A');
            git('commit', '-qm', 'retire');
            const head = git('rev-parse', 'HEAD').trim();

            const eventPath = path.join(dir, 'event.json');
            fs.writeFileSync(eventPath, JSON.stringify({ before: base }));
            const outputPath = path.join(dir, 'output.txt');
            fs.writeFileSync(outputPath, '');

            execFileSync('bash', [path.join(ROOT, '.github/scripts/captions-changed.sh')], {
                cwd: dir,
                env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, GITHUB_SHA: head },
            });

            const output = fs.readFileSync(outputPath, 'utf8');
            expect(output).toContain('src/config/kept.json');
            expect(output).not.toContain('src/config/retired.json');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('documentation', () => {
    it('docs/product.md features auto-generated six-language captions', () => {
        const product = readFileSync(path.join(ROOT, 'docs/product.md'), 'utf8');
        expect(product).toMatch(/auto-generated simple-video captions/i);
        expect(product).toContain('stories/009-auto-caption-simple-videos/story.md');
    });

    it('README.md mentions the caption script and GOOGLE_API_KEY', () => {
        const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
        expect(readme).toContain('scripts/generate-captions.mjs');
        expect(readme).toContain('GOOGLE_API_KEY');
    });

    it('AGENTS.md instructs auto captions on push and no hand-backfill', () => {
        const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
        expect(agents).toMatch(/simpleVideoUrl/);
        expect(agents).toMatch(/captions automatically on push/i);
        expect(agents).toMatch(/not.*hand-backfill/i);
    });
});