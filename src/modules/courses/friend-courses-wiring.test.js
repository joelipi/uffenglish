import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the /courses wiring. The container pulls in Vite's
// import.meta.glob + react-query + the router, so its composition is asserted
// on raw source (the repo convention for load-time wiring).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const container = read('../../components/courses/CourseListingsContainer.jsx');
const route = read('../../routes/CoursesRoute.jsx');

describe('CourseListingsContainer wiring', () => {
    it('queries the friend courses via the loader + logic modules', () => {
        expect(container).toContain("queryKey: ['friend-courses']");
        expect(container).toContain('listFriendCourses(');
        expect(container).toContain('loadConfigEntries(');
    });

    it('renders the presentational CourseListings', () => {
        expect(container).toContain('<CourseListings');
    });
});

describe('CoursesRoute wiring', () => {
    it('finishes the preloader on mount', () => {
        expect(route).toContain('finishPreloader()');
        const effectAt = route.indexOf('useEffect(');
        const finishAt = route.indexOf('finishPreloader()');
        expect(effectAt).toBeGreaterThan(-1);
        expect(finishAt).toBeGreaterThan(effectAt);
    });
});
