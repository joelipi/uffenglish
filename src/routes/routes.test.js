import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the homepage/dashboard route split. The route table pulls in
// the full element graph (Supabase, preloader), so this asserts the wiring by
// raw source. `/home` must precede `/:shareCode` or `home` is captured as a
// share code.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'routes.jsx'), 'utf8');

describe('routes.jsx homepage split', () => {
    it('mounts PublicHomeRoute at /', () => {
        expect(src).toContain("{ path: '/', element: <PublicHomeRoute /> }");
    });

    it('mounts HomeRoute at /home', () => {
        expect(src).toContain("{ path: '/home', element: <HomeRoute /> }");
    });

    it('registers /home before the /:shareCode route', () => {
        const homeAt = src.indexOf("{ path: '/home', element: <HomeRoute /> }");
        const shareCodeAt = src.indexOf("{ path: '/:shareCode'");
        expect(homeAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(homeAt).toBeLessThan(shareCodeAt);
    });

    it('keeps the catch-all pointing at the public homepage', () => {
        expect(src).toContain("{ path: '*', element: <Navigate to=\"/\" replace /> }");
    });
});
