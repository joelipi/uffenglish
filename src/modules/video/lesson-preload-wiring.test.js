// src/modules/video/lesson-preload-wiring.test.js
// Story 031: source guards for the lesson-preload wiring. The bulk all-steps
// prefetch loop must be gone from index.html, and the web-only lesson-init hook
// must prefetch the first video (high priority) before loading lesson content.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('use-initialize-lesson-webonly.js preload wiring', () => {
    const source = read('src/hooks/use-initialize-lesson-webonly.js');

    it('imports the planner and executor from the lesson-preload module', () => {
        expect(source).toMatch(
            /import\s*\{\s*planLessonPreload,\s*preloadLessonVideos\s*\}\s*from\s*'\.\.\/modules\/video\/lesson-preload\.js'/
        );
    });

    it('calls preloadLessonVideos(planLessonPreload(lesson, getVideoUrl))', () => {
        expect(source).toContain('preloadLessonVideos(planLessonPreload(lesson, getVideoUrl))');
    });

    it('runs the preload after preloadLessonAssets and before loadLessonContent', () => {
        const assetsIdx = source.indexOf('await window.preloadLessonAssets(');
        const preloadIdx = source.indexOf('preloadLessonVideos(planLessonPreload(lesson, getVideoUrl))');
        const contentIdx = source.indexOf('await loadLessonContent(');
        expect(assetsIdx).toBeGreaterThan(-1);
        expect(preloadIdx).toBeGreaterThan(assetsIdx);
        expect(contentIdx).toBeGreaterThan(preloadIdx);
    });
});

describe('index.html bulk video prefetch removal', () => {
    const source = read('index.html');

    it('no longer loops over every step to prefetch videos', () => {
        expect(source).not.toContain('lessonData.steps.forEach');
        expect(source).not.toContain('fetch(buildVideoUrlFn(slug))');
    });

    it('keeps the poster preload guard', () => {
        expect(source).toContain('buildPosterUrlFn(posterSlug)');
        expect(source).toContain('lessonData?.steps?.[0]?.introBackgroundVideoUrl');
    });

    it('keeps the progress bar interval', () => {
        expect(source).toContain('#ui-progress-bar');
        expect(source).toContain('progressInterval');
    });
});
