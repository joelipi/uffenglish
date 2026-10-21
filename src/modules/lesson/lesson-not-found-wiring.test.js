import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the dead-link contract on the lesson route.
//
// A course that was retired (or a lesson id the regenerated config no longer
// has) must answer with the app's not-found page, NOT with the critical-error
// screen whose message tells the visitor to check their internet connection.
// The browser cannot be exercised for the retired-course case in vitest, so
// this locks the wiring: the classification, the tagging, and the order in
// which the not-found check runs before the critical message is set.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const appLayout = read('../../routes/AppLayout.jsx');
const lessonContainer = read('../../components/LessonContainer.jsx');
const initHook = read('../../hooks/use-initialize-lesson-webonly.js');
const notFoundRoute = read('../../routes/NotFoundRoute.jsx');
const notFoundPage = read('../../components/NotFoundPage.jsx');

/** The text between two markers, or '' when either marker is missing. */
function region(source, from, to) {
    const start = source.indexOf(from);
    if (start === -1) return '';
    const end = source.indexOf(to, start + from.length);
    if (end === -1) return '';
    return source.slice(start, end);
}

describe('course config classification (AppLayout)', () => {
    it('classifies the config response with the shared pure rule', () => {
        expect(appLayout).toContain("from '../modules/lesson/lesson-not-found-logic.js'");
        expect(appLayout).toContain('classifyCourseConfigResponse({ ok: res.ok, contentType, body })');
        expect(appLayout).toContain('COURSE_CONFIG_OUTCOME.ready');
    });

    it('tags a missing course config as a dead link', () => {
        expect(appLayout).toContain('markNotFoundError(new Error(`Course config not found: ${courseId}`)');
    });

    it('does not retry a missing config', () => {
        // Retrying a course that is gone only delays the not-found page.
        expect(appLayout).toContain('retry: (failureCount, failureError) => !isNotFoundError(failureError) && failureCount < 3,');
    });
});

describe('AppLayout answers a dead link with the not-found page', () => {
    it('renders the not-found page when the config is gone', () => {
        expect(appLayout).toMatch(/if \(isError && isNotFoundError\(error\)\) \{\s*return <NotFoundPage lang=\{lang\} \/>;\s*\}/);
    });

    it('keeps the critical-error screen for a technical failure only', () => {
        const block = region(appLayout, '// Side effect: handle config fetch error', '}, [isError, error, courseId]);');
        expect(block).not.toBe('');
        const guardAt = block.indexOf('isNotFoundError(error)');
        const criticalAt = block.indexOf('setCriticalErrorMessage');
        expect(guardAt).toBeGreaterThan(-1);
        expect(criticalAt).toBeGreaterThan(guardAt);
        // The dead-link branch returns before the critical message is set, so
        // the two answers can never both be on screen.
        expect(block.slice(guardAt, criticalAt)).toContain('return;');
        expect(block).toContain('clearCriticalError()');
    });
});

describe('LessonContainer answers a dead link with the not-found page', () => {
    it('turns a not-found failure into the not-found page', () => {
        expect(lessonContainer).toContain("from '../modules/lesson/lesson-not-found-logic.js'");
        expect(lessonContainer).toContain('} else if (isNotFoundError(result?.error)) {');
        expect(lessonContainer).toContain('setNotFound(true);');
        expect(lessonContainer).toMatch(/if \(notFound\) \{\s*return <NotFoundPage lang=\{labelLang\} \/>;\s*\}/);
    });
});

describe('lesson initialization (use-initialize-lesson-webonly)', () => {
    it('marks a lesson the course no longer has as a dead link', () => {
        expect(initHook).toContain('isLessonMissingFromConfig(configData, resolvedLessonId)');
        expect(initHook).toContain("markNotFoundError(new Error(`Lesson '${resolvedLessonId}' not found in course configuration.`)");
    });

    it('sets the critical message only for a technical failure', () => {
        const block = region(initHook, '} catch (error) {', 'return { success: false, error };');
        expect(block).not.toBe('');
        const guardAt = block.indexOf('if (!isNotFoundError(error)) {');
        const criticalAt = block.indexOf('setCriticalErrorMessage');
        expect(guardAt).toBeGreaterThan(-1);
        expect(criticalAt).toBeGreaterThan(guardAt);
    });
});

describe('one not-found card for both answers', () => {
    it('renders the shared card from the 404 route and from the lesson route', () => {
        expect(notFoundRoute).toContain("import NotFoundPage from '../components/NotFoundPage.jsx'");
        expect(notFoundRoute).toContain('<NotFoundPage lang={lang} />');
        expect(appLayout).toContain("import NotFoundPage from '../components/NotFoundPage.jsx'");
        expect(lessonContainer).toContain("import NotFoundPage from './NotFoundPage.jsx'");
    });

    it('fills its parent so the card looks the same inside the lesson frame', () => {
        expect(notFoundPage).toContain("height: '100%'");
    });
});
