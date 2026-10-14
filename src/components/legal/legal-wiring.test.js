// Source guard for the legal-page wiring: routes exist, they precede the
// single-segment /:shareCode catch-all, no screen renders a legal footer, and
// the user-menu drawer links to both pages. The components pull in Supabase /
// react-query graphs, so this locks each call site by raw source (AGENTS.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const routes = read('../../routes/routes.jsx');
const homeLanding = read('../homescreen/HomeLanding.jsx');
const homeScreen = read('../homescreen/HomeScreen.jsx');
const privacyRoute = read('../../routes/PrivacyRoute.jsx');
const termsRoute = read('../../routes/TermsRoute.jsx');

describe('legal routes', () => {
    it('registers /privacy and /terms', () => {
        expect(routes).toContain("path: '/privacy'");
        expect(routes).toContain("path: '/terms'");
        expect(routes).toContain('<PrivacyRoute />');
        expect(routes).toContain('<TermsRoute />');
    });

    it('declares both before the /:shareCode catch-all', () => {
        const catchAll = routes.indexOf("path: '/:shareCode'");
        const privacyAt = routes.indexOf("path: '/privacy'");
        const termsAt = routes.indexOf("path: '/terms'");
        expect(catchAll).toBeGreaterThan(-1);
        expect(privacyAt).toBeGreaterThan(-1);
        expect(termsAt).toBeGreaterThan(-1);
        expect(privacyAt).toBeLessThan(catchAll);
        expect(termsAt).toBeLessThan(catchAll);
    });

    it('loads the legal docs as raw markdown (single source of truth)', () => {
        expect(privacyRoute).toContain('docs/legal/privacy-policy.md?raw');
        expect(termsRoute).toContain('docs/legal/terms-of-service.md?raw');
    });
});

describe('footer removal', () => {
    // The Privacy/Terms links live in the user-menu drawer (below), the
    // sign-up surfaces (LegalLinks) and the /privacy, /terms routes — never in
    // a page footer. These absence assertions fail if the footer is re-added.
    it('does not render LegalFooter on the public homepage', () => {
        expect(homeLanding).not.toContain("import LegalFooter");
        expect(homeLanding).not.toContain('<LegalFooter');
    });

    it('does not render LegalFooter on the app dashboard', () => {
        expect(homeScreen).not.toContain("import LegalFooter");
        expect(homeScreen).not.toContain('<LegalFooter');
    });

    it('renders no footer element styling on the homepage', () => {
        expect(homeLanding).not.toContain('uff-footer');
    });
});

describe('user-menu drawer', () => {
    // Scope to the nav block: from the Profile entry to the closing </nav>.
    const profileAt = homeScreen.indexOf("Strings.get('home_profile'");
    const navEnd = homeScreen.indexOf('</nav>', profileAt);
    const menuBlock = homeScreen.slice(profileAt, navEnd);

    it('contains the Profile entry and closes the nav', () => {
        expect(profileAt).toBeGreaterThan(-1);
        expect(navEnd).toBeGreaterThan(profileAt);
    });

    it('links to the privacy page from the menu', () => {
        expect(menuBlock).toContain('to="/privacy"');
    });

    it('links to the terms page from the menu', () => {
        expect(menuBlock).toContain('to="/terms"');
    });
});
