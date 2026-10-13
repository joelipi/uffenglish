// scripts/lib/pwa-build-output.test.js
// End-to-end pin for the production build artefacts behind Task 2's
// "production build" and "generated precache manifest" ACs. `dist/` is
// gitignored build output, so there is nothing committed to assert on — this
// test runs `npm run build` once (~4s; 300s timeout like the thumbnail
// subprocess tests) and asserts on what it emitted:
//
// - the PWA artefacts exist: `sw.js`, a `workbox-*.js` runtime,
//   `manifest.webmanifest`, `registerSW.js`;
// - the built `index.html` links the manifest and the registration script;
// - the emitted manifest carries the install contract (`start_url: '/home'`,
//   standalone, scope, 192/512 icons);
// - the generated precache list contains the shell (index, manifest, icons,
//   hashed chunks) and none of the excluded assets (wasm/whisper model paths,
//   the standalone pages, the oversized AI chunks, the icon source, test files);
// - the emitted navigation route wires the deny list verbatim (both
//   extensionless standalone forms).
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');

const read = (rel) => readFileSync(path.join(DIST, rel), 'utf8');

/** The `"url": ...` entries of the generated `precacheAndRoute([...])` list. */
function precacheUrls(sw) {
    return [...sw.matchAll(/\{\s*"url":\s*"([^"]+)"/g)].map((m) => m[1]);
}

beforeAll(() => {
    execFileSync('npm', ['run', 'build', '--silent'], {
        cwd: ROOT,
        timeout: 300000,
        stdio: 'pipe',
    });
}, 300000);

describe('production build emits the PWA artefacts', () => {
    it('emits sw.js, the workbox runtime, the manifest and the register script', () => {
        for (const rel of ['sw.js', 'manifest.webmanifest', 'registerSW.js']) {
            expect(existsSync(path.join(DIST, rel)), `dist/${rel}`).toBe(true);
        }
        const runtimes = readdirSync(DIST).filter((f) => /^workbox-.*\.js$/.test(f));
        expect(runtimes.length, 'dist/workbox-*.js').toBeGreaterThan(0);
    });

    it('links the manifest and the registration script from the built index.html', () => {
        const html = read('index.html');
        expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
        expect(html).toContain('src="/registerSW.js"');
    });

    it('emits a manifest carrying the install contract', () => {
        const manifest = JSON.parse(read('manifest.webmanifest'));
        expect(manifest.start_url).toBe('/home');
        expect(manifest.scope).toBe('/');
        expect(manifest.display).toBe('standalone');
        const sizes = manifest.icons.map((i) => i.sizes);
        expect(sizes).toContain('192x192');
        expect(sizes).toContain('512x512');
    });

    it('precaches the app shell: index, manifest, icons and hashed chunks', () => {
        const urls = precacheUrls(read('sw.js'));
        expect(urls.length, 'precache entries').toBeGreaterThan(0);
        for (const required of [
            'index.html',
            'manifest.webmanifest',
            'pwa-192x192.png',
            'pwa-512x512.png',
            'maskable-icon-512x512.png',
            'favicon.ico',
            'apple-touch-icon-180x180.png',
        ]) {
            expect(urls, required).toContain(required);
        }
        expect(urls.some((u) => /^assets\/.*\.js$/.test(u)), 'a hashed JS chunk').toBe(true);
        expect(urls.some((u) => /\.css$/.test(u)), 'a stylesheet').toBe(true);
    });

    it('precaches none of the excluded assets', () => {
        const urls = precacheUrls(read('sw.js'));
        expect(urls.some((u) => u.startsWith('wasm/')), 'wasm/ model binaries').toBe(false);
        expect(urls.some((u) => u.startsWith('whisper/')), 'whisper/ model assets').toBe(false);
        for (const forbidden of [
            'recorder.html',
            'landing.html',
            'idioms-',
            'idiom-worker',
            'listeningbot',
            'pwa-icon-source',
            '.test.js',
        ]) {
            expect(urls.some((u) => u.includes(forbidden)), forbidden).toBe(false);
        }
    });

    it('wires the deny list into the emitted navigation route', () => {
        const sw = read('sw.js');
        // Both extensionless standalone forms must reach the emitted route —
        // denying only the `.html` form would leave the served path answered
        // by the cached shell.
        expect(sw).toContain('recorder(\\.html)?');
        expect(sw).toContain('landing(\\.html)?');
    });
});
