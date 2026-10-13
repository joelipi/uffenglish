// scripts/lib/pwa-manifest.test.js
// The install contract for the app: what the web app manifest must contain, the
// icons that must exist on disk, and the build wiring that produces them. Chrome
// install criteria (web.dev/articles/install-criteria): HTTPS, name/short_name,
// a 192px AND a 512px icon, start_url, a standalone-family display, and
// prefer_related_applications absent/false. The installed app must open on the
// user dashboard `/home`, not the marketing homepage `/`.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    buildPwaManifest,
    PWA_ICONS,
    START_URL,
    APP_SCOPE,
    APP_ID,
    APP_SHORT_NAME,
    APP_DESCRIPTION,
    THEME_COLOR,
    BACKGROUND_COLOR,
} from './pwa-manifest.js';
import { matchesPwaNavigationDenyList } from './pwa-navigation-deny-list.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function pngSize(file) {
    const buf = readFileSync(file);
    // 8-byte PNG signature, then the IHDR chunk: length(4) type(4) width(4) height(4).
    expect(buf.subarray(0, 8).toString('hex'), `${file} is a PNG`).toBe('89504e470d0a1a0a');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('PWA manifest install contract', () => {
    const manifest = buildPwaManifest();

    it('opens the installed app on /home with the whole origin in scope', () => {
        expect(manifest.start_url).toBe('/home');
        expect(START_URL).toBe('/home');
        expect(manifest.scope).toBe('/');
        expect(APP_SCOPE).toBe('/');
        // Stable identity independent of start_url, so changing the launch page
        // later does not register as a different app.
        expect(manifest.id).toBe('/');
        expect(APP_ID).toBe('/');
    });

    it('is standalone with a name, short name and description', () => {
        expect(manifest.display).toBe('standalone');
        expect(['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'])
            .toContain(manifest.display);
        expect(manifest.name).toBeTruthy();
        expect(manifest.short_name).toBe('UFF');
        expect(APP_SHORT_NAME).toBe('UFF');
        expect(manifest.description).toBe(APP_DESCRIPTION);
        expect(manifest.description).toBeTruthy();
        expect(manifest.lang).toBe('en');
        expect(manifest.dir).toBe('ltr');
    });

    it('never prefers a related native application (blocks the install prompt)', () => {
        expect(manifest.prefer_related_applications).toBe(false);
    });

    it('carries the app shell theme and background colours', () => {
        expect(manifest.theme_color).toBe(THEME_COLOR);
        expect(manifest.background_color).toBe(BACKGROUND_COLOR);
        expect(THEME_COLOR).toMatch(HEX_COLOR);
        expect(BACKGROUND_COLOR).toMatch(HEX_COLOR);
    });

    it('ships a 192px and a 512px "any" icon plus a 512px maskable icon', () => {
        // Every icon is a PNG: assert the type per icon, not via the filter
        // below (a non-PNG entry would otherwise be silently excluded, not failed).
        for (const icon of PWA_ICONS) expect(icon.type, icon.src).toBe('image/png');
        const png = PWA_ICONS.filter((i) => i.type === 'image/png');
        const anyIcons = png.filter((i) => i.purpose === 'any');
        expect(anyIcons.map((i) => i.sizes)).toContain('192x192');
        expect(anyIcons.map((i) => i.sizes)).toContain('512x512');
        expect(png.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
        // Absolute paths so the manifest is valid at any base path.
        for (const icon of png) expect(icon.src.startsWith('/')).toBe(true);
    });

    it('every manifest icon exists on disk at the size it declares', () => {
        for (const icon of PWA_ICONS) {
            const file = path.join(REPO_ROOT, 'public', icon.src);
            expect(existsSync(file), `${file} exists`).toBe(true);
            const [w, h] = icon.sizes.split('x').map(Number);
            expect(pngSize(file), `${icon.src} is ${icon.sizes}`).toEqual({ width: w, height: h });
        }
    });

    it('ships the head-link icons index.html points at', () => {
        for (const rel of ['public/favicon.ico', 'public/apple-touch-icon-180x180.png']) {
            const file = path.join(REPO_ROOT, rel);
            expect(existsSync(file), `${rel} exists`).toBe(true);
            expect(readFileSync(file).length).toBeGreaterThan(0);
        }
    });

    it('keeps the icon source a PNG (committed jpg/jpeg/mp4 under public/ is forbidden)', () => {
        // scripts/generate-thumbnails.test.js keeps lesson media R2-only and
        // fails on any committed jpg/jpeg/mp4 under public/ — so the icon
        // source must stay a lossless PNG.
        const source = path.join(REPO_ROOT, 'public/pwa-icon-source.png');
        expect(existsSync(source)).toBe(true);
        expect(pngSize(source)).toEqual({ width: 192, height: 192 });
        expect(existsSync(path.join(REPO_ROOT, 'public/pwa-icon-source.jpeg'))).toBe(false);
    });
});

describe('index.html PWA head links', () => {
    const html = read('index.html');

    it('links the generated favicon and apple-touch-icon', () => {
        expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
        expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">');
    });

    it('declares the theme colour, standalone web-app metadata', () => {
        // Tied to the manifest constant so the two can never drift.
        expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR}">`);
        expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
        expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    });
});

describe('vite.config.js PWA build wiring', () => {
    const config = read('vite.config.js');

    it('generates the manifest from the single-source module', () => {
        expect(config).toContain("import { VitePWA } from 'vite-plugin-pwa'");
        expect(config).toContain("import { buildPwaManifest } from './scripts/lib/pwa-manifest.js'");
        expect(config).toContain('manifest: buildPwaManifest()');
        expect(config).toContain("manifestFilename: 'manifest.webmanifest'");
        // Single source of truth: the launch URL must not be inlined here.
        expect(config).not.toContain('start_url');
    });

    it('registers a plain service worker without a forced mid-session reload', () => {
        // `prompt` + `script` injects a bare navigator.serviceWorker.register,
        // so a new build never reloads a tab mid-lesson (the reader would lose
        // an in-progress recording). `autoUpdate` would reload.
        expect(config).toContain("registerType: 'prompt'");
        expect(config).toContain("injectRegister: 'script'");
        expect(config).not.toContain('autoUpdate');
        expect(config).toContain("strategies: 'generateSW'");
    });

    it('precaches the app shell with an SPA navigation fallback', () => {
        expect(config).toContain("navigateFallback: 'index.html'");
        expect(config).toContain('navigateFallbackDenylist: PWA_NAVIGATION_DENY_LIST');
        // The deny list itself is a pure module with behavioural tests
        // (pwa-navigation-deny-list.test.js) — asserting the regex text here
        // would let an unreachable-but-present pattern pass, so only the
        // wiring is asserted at this level.
        expect(config).toContain(
            "import { PWA_NAVIGATION_DENY_LIST } from './scripts/lib/pwa-navigation-deny-list.js'"
        );
        expect(config).toContain('cleanupOutdatedCaches: true');
        expect(config).toContain('maximumFileSizeToCacheInBytes');
    });

    it('denies both URL forms of every real standalone page (behaviour, not config text)', () => {
        // Cloudflare serves public/<name>.html at its extensionless path, so the
        // deny list has to cover `/x` AND `/x.html` (and their query strings) or
        // the cached shell shadows the real page.
        for (const stem of ['/recorder', '/landing']) {
            for (const path of [stem, `${stem}.html`, `${stem}?x=1`, `${stem}.html?x=1`]) {
                expect(matchesPwaNavigationDenyList(path), path).toBe(true);
            }
        }
        for (const path of ['/home', '/privacy', '/courses', '/abc12', '/course/model/lesson/m-g']) {
            expect(matchesPwaNavigationDenyList(path), path).toBe(false);
        }
    });

    it('keeps oversized, non-shell and operator-only assets out of the precache', () => {
        expect(config).toContain('globIgnores: WORKBOX_IGNORES');
        for (const pattern of ["'**/wasm/**'", "'**/whisper/**'", "'**/*.test.js'", "'recorder.html'", "'landing.html'"]) {
            expect(config, pattern).toContain(pattern);
        }
        expect(config).toContain('showMaximumFileSizeToCacheInBytesWarning: true');
    });

    it('keeps the service worker off the dev server', () => {
        expect(config).toContain('devOptions: { enabled: false }');
    });

    it('generates icons with the open-source assets generator', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.scripts['pwa:assets']).toContain('pwa-assets-generator');
        expect(pkg.devDependencies['vite-plugin-pwa']).toBeTruthy();
        expect(pkg.devDependencies['@vite-pwa/assets-generator']).toBeTruthy();
        expect(pkg.dependencies['@khmyznikov/pwa-install']).toBeTruthy();
        expect(read('pwa-assets.config.js')).toContain("images: ['public/pwa-icon-source.png']");
    });
});
