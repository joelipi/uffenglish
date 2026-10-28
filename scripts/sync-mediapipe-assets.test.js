// Tests for the MediaPipe asset sync (stories/100).
//
// The script stages ~41 MB of WASM plus the segmenter model into the gitignored
// `public/mediapipe/` before `vite build`. What matters: it is idempotent (a
// rebuild must not re-copy or re-download), it never reaches the network when a
// copy already exists, and a missing package is reported rather than silently
// shipping a studio that records the raw camera.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncFile, syncWasm, syncModel, MODEL_FILE } from './sync-mediapipe-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'sync-mediapipe-assets.mjs');

let root;

function write(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-mediapipe-'));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('syncFile', () => {
    it('copies a missing target, then reports it current (idempotent)', () => {
        const source = path.join(root, 'src', 'a.wasm');
        const target = path.join(root, 'out', 'a.wasm');
        write(source, 'WASM-BYTES');
        expect(syncFile(source, target)).toBe('copied');
        expect(fs.readFileSync(target, 'utf8')).toBe('WASM-BYTES');
        expect(syncFile(source, target)).toBe('current');
    });

    it('re-copies when the target size differs (a truncated copy)', () => {
        const source = path.join(root, 'src', 'a.wasm');
        const target = path.join(root, 'out', 'a.wasm');
        write(source, 'FULL');
        write(target, 'F');
        expect(syncFile(source, target)).toBe('copied');
        expect(fs.readFileSync(target, 'utf8')).toBe('FULL');
    });

    it('reports a missing source instead of throwing', () => {
        expect(syncFile(path.join(root, 'nope.wasm'), path.join(root, 'out', 'x'))).toBe('missing-source');
    });
});

describe('syncWasm', () => {
    it('copies every file from the fileset directory into out/wasm', () => {
        const sourceDir = path.join(root, 'pkg', 'wasm');
        write(path.join(sourceDir, 'vision_wasm_internal.js'), 'JS');
        write(path.join(sourceDir, 'vision_wasm_internal.wasm'), 'WASM');
        const outDir = path.join(root, 'public', 'mediapipe');
        const result = syncWasm({ sourceDir, outDir });
        expect(result.copied.sort()).toEqual(['vision_wasm_internal.js', 'vision_wasm_internal.wasm']);
        expect(fs.existsSync(path.join(outDir, 'wasm', 'vision_wasm_internal.wasm'))).toBe(true);
    });

    it('reports a missing package directory rather than copying nothing silently', () => {
        const result = syncWasm({ sourceDir: path.join(root, 'absent'), outDir: path.join(root, 'out') });
        expect(result.missing).toHaveLength(1);
        expect(result.copied).toEqual([]);
    });
});

describe('syncModel', () => {
    it('downloads once, then uses the cache without touching the network', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        });
        const outDir = path.join(root, 'out');
        const cacheDir = path.join(root, 'cache');
        expect(await syncModel({ outDir, cacheDir, fetchImpl })).toBe('downloaded');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(outDir, MODEL_FILE))).toBe(true);

        // Second run: cache hit, no request.
        expect(await syncModel({ outDir, cacheDir, fetchImpl })).toBe('current');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('restores from the cache after the output was cleared', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([9]).buffer,
        });
        const outDir = path.join(root, 'out');
        const cacheDir = path.join(root, 'cache');
        await syncModel({ outDir, cacheDir, fetchImpl });
        fs.rmSync(outDir, { recursive: true, force: true });
        expect(await syncModel({ outDir, cacheDir, fetchImpl })).toBe('copied');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('reports unavailable instead of throwing when the download fails', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
        const result = await syncModel({
            outDir: path.join(root, 'out'),
            cacheDir: path.join(root, 'cache'),
            fetchImpl,
        });
        expect(result).toBe('unavailable');
    });
});

describe('build wiring for the studio bundle (stories/100)', () => {
    const viteConfig = fs.readFileSync(path.join(__dirname, '..', 'vite.config.js'), 'utf8');

    it('emits the looks entry at a STABLE path and keeps the hashed main chunk', () => {
        expect(viteConfig).toContain("'recorder-looks': resolve(__dirname, 'src/looks-standalone-entry.js')");
        expect(viteConfig).toContain("chunk.name === 'recorder-looks'");
        expect(viteConfig).toContain("? 'recorder-looks.js'");
        expect(viteConfig).toContain("'assets/[name]-[hash].js'");
    });

    it('keeps both operator-only assets out of the learner precache', () => {
        // An unanchored `toContain('mediapipe')` would be satisfied by the
        // comment above the array, so the assertions are scoped to the list.
        const start = viteConfig.indexOf('const WORKBOX_IGNORES = [');
        const end = viteConfig.indexOf(']', start);
        const ignores = viteConfig.slice(start, end);
        expect(ignores).toContain("'recorder-looks.js'");
        expect(ignores).toContain("'**/mediapipe/**'");
    });
});

describe('sync-mediapipe-assets CLI', () => {
    it('stages the wasm fileset into the directory the build copies from', () => {
        const outDir = path.join(root, 'out');
        const stdout = execFileSync(process.execPath, [SCRIPT], {
            env: { ...process.env, MEDIAPIPE_OUT_DIR: outDir },
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(stdout).toContain('[mediapipe] wasm:');
        const wasmDir = path.join(outDir, 'wasm');
        expect(fs.existsSync(wasmDir)).toBe(true);
        // The loader file the resolver requests, by name.
        expect(fs.existsSync(path.join(wasmDir, 'vision_wasm_internal.js'))).toBe(true);
    }, 60000);
});
