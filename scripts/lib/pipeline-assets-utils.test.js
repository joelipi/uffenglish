// Unit tests for the pure asset-upload planning (story 040, Task 8). A fake
// fs-like module records the temp tree so no real filesystem is touched.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    KNOWN_ASSET_DIRS,
    KNOWN_ASSET_FILES,
    collectAssetTargets,
    contentTypeForAsset,
    pipelineAssetKey,
} from './pipeline-assets-utils.js';

// Minimal in-memory fs: a map of abs path -> 'file' | child names.
function makeFakeFs(tree) {
    const dirs = new Set(Object.keys(tree));
    const children = new Set();
    for (const [dir, entries] of Object.entries(tree)) {
        for (const name of entries) children.add(path.join(dir, name));
    }
    return {
        readdirSync: (dir) => tree[dir] || [],
        statSync: (p) => {
            if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false };
            if (children.has(p)) return { isDirectory: () => false, isFile: () => true };
            throw new Error(`ENOENT ${p}`);
        },
    };
}

const ROOT = '/assets';

describe('pipeline-assets-utils', () => {
    it('collects known asset dirs, skips dotfiles, sorts, keys under pipeline-assets/', () => {
        const tree = {
            [ROOT]: ['fonts', 'backgrounds', 'audio', 'overlays', 'video_data.csv', '.DS_Store'],
            [path.join(ROOT, 'fonts')]: ['Kalam-Bold.ttf', '.DS_Store'],
            [path.join(ROOT, 'backgrounds')]: ['bg.mp4'],
            [path.join(ROOT, 'audio')]: ['track.mp3'],
            [path.join(ROOT, 'overlays')]: ['lower.png'],
        };
        const targets = collectAssetTargets(makeFakeFs(tree), ROOT);
        const keys = targets.map((t) => t.r2Key);
        expect(keys).toEqual([
            'pipeline-assets/audio/track.mp3',
            'pipeline-assets/backgrounds/bg.mp4',
            'pipeline-assets/fonts/Kalam-Bold.ttf',
            'pipeline-assets/overlays/lower.png',
        ]);
        expect(keys.some((k) => k.includes('.DS_Store'))).toBe(false);
        expect(keys.every((k) => k.startsWith('pipeline-assets/'))).toBe(true);
    });

    it('never emits pipeline-assets/video_data.csv even when a local copy exists', () => {
        // Story 052: that key is the post-render output sync-srt.yml reads; the
        // uploader must not clobber it with a stale local CSV.
        const tree = {
            [ROOT]: ['fonts', 'video_data.csv'],
            [path.join(ROOT, 'fonts')]: ['Kalam-Bold.ttf'],
        };
        const keys = collectAssetTargets(makeFakeFs(tree), ROOT).map((t) => t.r2Key);
        expect(keys).not.toContain('pipeline-assets/video_data.csv');
        expect(keys).toEqual(['pipeline-assets/fonts/Kalam-Bold.ttf']);
    });

    it('maps content types and falls back to octet-stream', () => {
        expect(contentTypeForAsset('Kalam-Bold.ttf')).toBe('font/ttf');
        expect(contentTypeForAsset('bg.mp4')).toBe('video/mp4');
        expect(contentTypeForAsset('track.mp3')).toBe('audio/mpeg');
        expect(contentTypeForAsset('lower.png')).toBe('image/png');
        expect(contentTypeForAsset('video_data.csv')).toBe('text/csv');
        expect(contentTypeForAsset('mystery.xyz')).toBe('application/octet-stream');
    });

    it('normalizes Windows separators in pipelineAssetKey', () => {
        expect(pipelineAssetKey('fonts\\Kalam-Bold.ttf')).toBe('pipeline-assets/fonts/Kalam-Bold.ttf');
    });

    it('exposes the known dirs and an empty root-file list', () => {
        expect(KNOWN_ASSET_DIRS).toEqual(['fonts', 'backgrounds', 'audio', 'overlays']);
        // Story 052: video_data.csv is a post-render output, not an uploadable input.
        expect(KNOWN_ASSET_FILES).toEqual([]);
    });
});
