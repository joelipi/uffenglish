import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the topic pages' wiring. The containers pull in Vite's
// import.meta.glob + react-query + the router, so their composition is
// asserted on raw source (the repo convention for load-time wiring).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const welcomeContainer = read('../../components/courses/WelcomePageContainer.jsx');
const tagContainer = read('../../components/courses/TagPageContainer.jsx');
const welcomeRoute = read('../../routes/WelcomeRoute.jsx');
const tagRoute = read('../../routes/TagRoute.jsx');
const routesSrc = read('../../routes/routes.jsx');
const landingContainer = read('../../components/homescreen/HomeLandingContainer.jsx');

describe('the topic page containers', () => {
    it('load the configs and derive the tags from them', () => {
        expect(welcomeContainer).toContain("queryKey: ['config-entries']");
        expect(welcomeContainer).toContain('loadConfigEntries(');
        expect(welcomeContainer).toContain('collectCourseTags(');
        expect(welcomeContainer).toContain('<WelcomePage');
    });

    it('keep the courses of the tag in the URL, with the hero image resolved', () => {
        expect(tagContainer).toContain("queryKey: ['config-entries']");
        expect(tagContainer).toContain('loadConfigEntries(');
        expect(tagContainer).toContain('listCoursesByTag(');
        expect(tagContainer).toContain('findTagLabel(');
        expect(tagContainer).toContain('resolveCourseHeroImage(');
        expect(tagContainer).toContain('<TagPage');
    });
});

describe('the topic routes', () => {
    it('finish the preloader on mount', () => {
        for (const route of [welcomeRoute, tagRoute]) {
            expect(route).toContain('finishPreloader()');
            const effectAt = route.indexOf('useEffect(');
            const finishAt = route.indexOf('finishPreloader()');
            expect(effectAt).toBeGreaterThan(-1);
            expect(finishAt).toBeGreaterThan(effectAt);
        }
    });

    it('declare /welcome and /tags/:tag inside the app shell', () => {
        expect(routesSrc).toContain("{ path: '/welcome', element: <WelcomeRoute /> }");
        expect(routesSrc).toContain("{ path: '/tags/:tag', element: <TagRoute /> }");
    });

    it('declare /welcome before the /:shareCode catch-all', () => {
        // A single-segment path declared after the catch-all is read as a
        // share code, so the welcome page would never render.
        const welcomeAt = routesSrc.indexOf("path: '/welcome'");
        const shareCodeAt = routesSrc.indexOf("path: '/:shareCode'");
        expect(welcomeAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(welcomeAt).toBeLessThan(shareCodeAt);
    });
});

describe('the welcome page is where "start without a friend code" lands', () => {
    it('navigates to the welcome path, not to the course list', () => {
        expect(landingContainer).toContain('navigate(WELCOME_PATH)');
        // The old target must be gone: the learner picks a topic first.
        expect(landingContainer).not.toContain('navigate(COURSE_LISTINGS_PATH)');
    });
});
