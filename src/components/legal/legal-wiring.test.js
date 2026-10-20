// Source guard for the legal-page wiring: routes exist, they precede the
// single-segment /:shareCode catch-all, the public homepage keeps its legal
// footer, the app dashboard renders none, and the user-menu drawer links to
// both pages. The components pull in Supabase / react-query graphs, so this
// locks each call site by raw source (AGENTS.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const routes = read('../../routes/routes.jsx');
const homeLanding = read('../homescreen/HomeLanding.jsx');
const homeScreen = read('../homescreen/HomeScreen.jsx');
const appHeader = read('../layout/AppHeader.web.jsx');
const appMenu = read('../../modules/navigation/app-menu-logic.js');
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

describe('homepage footer', () => {
    // The public homepage (/) keeps its Privacy/Terms footer; the dashboard
    // (/home) renders none — the links there live only in the user-menu
    // drawer (below). The dashboard absence assertions fail if the footer is
    // re-added to HomeScreen.
    it('renders LegalFooter on the public homepage', () => {
        expect(homeLanding).toContain("import LegalFooter from '../legal/LegalFooter.jsx'");
        expect(homeLanding).toContain('<LegalFooter');
    });

    it('does not render LegalFooter on the app dashboard', () => {
        expect(homeScreen).not.toContain("import LegalFooter");
        expect(homeScreen).not.toContain('<LegalFooter');
    });
});

describe('user-menu drawer', () => {
    // The drawer is the SHARED app header's menu (every inside page of the
    // app shows it), so its entries live in one module and the header renders
    // that module — not a copy of it.
    it('renders the shared menu entries', () => {
        expect(appHeader).toContain('APP_MENU_ITEMS.map');
        expect(appHeader).toContain('to={item.path}');
    });

    it('links to the privacy page from the menu', () => {
        expect(appMenu).toContain("path: '/privacy'");
        expect(appMenu).toContain("labelKey: 'legal_privacy'");
    });

    it('links to the terms page from the menu', () => {
        expect(appMenu).toContain("path: '/terms'");
        expect(appMenu).toContain("labelKey: 'legal_terms'");
    });
});
