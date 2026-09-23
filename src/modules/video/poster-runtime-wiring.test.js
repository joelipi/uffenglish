// src/modules/video/poster-runtime-wiring.test.js
// Source guards for the uniform R2-only poster contract
// (stories/011-auto-intro-poster, Tasks 3 & 4).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('video-loader.web.js intro config', () => {
    const source = read('src/modules/video/video-loader.web.js');

    it('sets posterSlug from the intro video slug', () => {
        expect(source).toMatch(/posterSlug:\s*step\.introBackgroundVideoUrl/);
    });
});

describe('IncomingVideoWidget.jsx', () => {
    const source = read('src/components/IncomingVideoWidget.jsx');

    it('derives the poster slug from currentVideo.config, not activeLessonId', () => {
        expect(source).toMatch(/currentVideo\.config\?\.posterSlug/);
        expect(source).not.toMatch(/activeLessonId/);
        expect(source).toMatch(/getPosterUrl\(posterSlug\)/);
        expect(source).toMatch(/getPosterLqip\(posterSlug\)/);
    });
});

describe('index.html poster preload', () => {
    const source = read('index.html');

    it('passes the first-step intro slug to buildPosterUrlFn', () => {
        expect(source).toMatch(/buildPosterUrlFn\(posterSlug\)/);
        expect(source).toMatch(/lessonData\?\.steps\?\.\[0\]\?\.introBackgroundVideoUrl/);
        expect(source).not.toMatch(/buildPosterUrlFn\(lessonData\.lessonId\)/);
    });
});

describe('vite.config.js proxy', () => {
    const source = read('vite.config.js');

    it('keeps the /assets/videos/ proxy (posters proxy to R2, no .jpg bypass)', () => {
        expect(source).toMatch(/['"]\/assets\/videos\/['"]\s*:/);
        expect(source).toMatch(/target:\s*'https:\/\/r2\.ultrafastfluency\.com'/);
        expect(source).not.toMatch(/\.jpg/);
    });
});

describe('tests/poster-check.spec.js', () => {
    const source = read('tests/poster-check.spec.js');

    it('expects the slug-keyed R2 poster path', () => {
        expect(source).toContain('/assets/videos/do_you_have_rolls_too.jpg');
    });
});

describe('video-processor.web.js UGC poster upload', () => {
    const source = read('src/modules/video/video-processor.web.js');

    it('derives the sibling jpg key and uploads it when a thumb is present', () => {
        expect(source).toMatch(/getUgcThumbKey\(key\)/);
        expect(source).toMatch(/step\.thumbBlob/);
        expect(source).toMatch(/step\.thumbArrayBuffer/);
        expect(source).toMatch(/contentType:\s*'image\/jpeg'/);
    });
});

describe('functions/api/upload-segment.js', () => {
    const source = read('functions/api/upload-segment.js');

    it('accepts .jpg/.jpeg keys under the shareCode namespace', () => {
        expect(source).toMatch(/\.jpg/);
        expect(source).toMatch(/\.jpeg/);
        expect(source).toMatch(/videos\/\$\{shareCode\}-/);
    });
});
