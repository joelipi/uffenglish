import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PurgeCSS } from 'purgecss';
import { LANG_HEADING_FONTS, langHeadingVariable } from './brand-fonts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const VITE_CONFIG = read('vite.config.js');
const APP_CSS = read('src', 'assets', 'css', 'app.css');
const INDEX_HTML = read('index.html');

/**
 * The exact call vite-plugin-purgecss makes (node_modules/vite-plugin-purgecss/dist/index.js):
 *
 *   content: [{ raw: transformedIndexHtml + ' ' + Object.entries(bundle)
 *                            .map(([, asset]) => asset.code).join('; '),
 *              extension: 'html' }]
 *   css:     [{ raw: bundle[file].source }]
 *
 * i.e. ONE raw string holding the HTML plus every bundled asset's code, and the
 * stylesheet under purge passed as raw text — NOT a glob of source files. An
 * earlier version of this guard used a `content` glob, which does not model the
 * plugin and produced a false "the :lang() rules are stripped" conclusion.
 *
 * The bundle's JS/JSX/CSS modules are read from src/ because the real bundle is
 * only reachable through `npm run build` (which cannot run in every environment);
 * what matters for PurgeCSS is the set of *tokens* those files contribute.
 */
function bundleCode() {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(js|jsx|css|html)$/.test(entry.name)) files.push(full);
        }
    };
    walk(path.join(ROOT, 'src'));
    return files.map((file) => readFileSync(file, 'utf8')).join('; ');
}

const safelistFromConfig = () => {
    // Mirrors the array literal in vite.config.js's purgecss() call.
    const block = VITE_CONFIG.match(/purgecss\(\{[\s\S]*?safelist:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    return [...block.matchAll(/\/\^[^\n]*?\/|'[^']*'/g)].map((m) => m[0]);
};

let purged;
const purgeAsTheBuildDoes = async () => {
    if (purged) return purged;
    const [result] = await new PurgeCSS().purge({
        content: [{ raw: INDEX_HTML + ' ' + bundleCode(), extension: 'html' }],
        css: [{ raw: APP_CSS }],
        safelist: [
            /^ivp-token-/,
            /^step-/,
            'toggled-off',
            'btn-bounce',
            'expanded',
        ],
    });
    purged = result.css;
    return purged;
};

describe('brand fonts survive the production PurgeCSS pass', () => {
    // Why the :lang() rules are safe without a safelist entry:
    //   1. purgecss's shouldKeepSelector() returns true for any node whose parent
    //      is a pseudo-class, so `h1`/`h2`/`h3` inside `:is(...)` are always kept,
    //      and a `:lang(x)` node hits the `default: continue` branch, so it never
    //      forces a rejection;
    //   2. the leading `#root` is an id that appears in index.html.
    // Both are pinned by the assertions below, so if either stopped holding the
    // failure lands here rather than in a silently unstyled production build.
    it.each(Object.keys(LANG_HEADING_FONTS))('keeps the :lang(%s) heading rule', async (lang) => {
        expect(await purgeAsTheBuildDoes()).toContain(`:lang(${lang})`);
    });

    it('keeps the face each :lang() rule points at', async () => {
        const css = await purgeAsTheBuildDoes();
        for (const lang of Object.keys(LANG_HEADING_FONTS)) {
            expect(css).toContain(`var(${langHeadingVariable(lang)})`);
        }
    });

    it('keeps the localized-span selectors inside headings', async () => {
        const css = await purgeAsTheBuildDoes();
        for (const lang of ['ja', 'zh', 'hi', 'bn']) {
            expect(css).toContain(`#root :is(h1, h2, h3) :lang(${lang})`);
        }
    });

    it('keeps the heading display rule and both weights', async () => {
        const css = await purgeAsTheBuildDoes();
        const heading = css.match(/#root h1,\s*#root h2,\s*#root h3\s*\{[^}]*\}/)?.[0] ?? '';
        expect(heading).toMatch(/font-family:\s*var\(--font-heading\)/);
        expect(heading).toMatch(/font-style:\s*italic/);
        expect(heading).toMatch(/font-weight:\s*700/);
        expect(css).toMatch(/#root h1\s*\{\s*font-weight:\s*900/);
    });

    it('keeps the body rule on the body variable', async () => {
        expect(await purgeAsTheBuildDoes()).toMatch(
            /body\s*\{[^}]*font-family:\s*var\(--font-body\)/
        );
    });

    it('keeps every heading override variable', async () => {
        const css = await purgeAsTheBuildDoes();
        for (const lang of Object.keys(LANG_HEADING_FONTS)) {
            expect(css).toContain(`${langHeadingVariable(lang)}:`);
        }
    });

    it('does not need a :lang() safelist entry to survive', async () => {
        // The claim this file exists to protect. If a future PurgeCSS/plugin
        // change did start stripping the rules, this is the assertion that says
        // so — and the fix would be a safelist entry in vite.config.js.
        const [result] = await new PurgeCSS().purge({
            content: [{ raw: INDEX_HTML + ' ' + bundleCode(), extension: 'html' }],
            css: [{ raw: APP_CSS }],
            safelist: [],
        });
        for (const lang of Object.keys(LANG_HEADING_FONTS)) {
            expect(result.css).toContain(`:lang(${lang})`);
        }
    });

    it('is still not importing the fonts in CSS (the <link> owns that)', async () => {
        expect(await purgeAsTheBuildDoes()).not.toMatch(/@import/);
    });

    describe('vite.config.js is what this guard models', () => {
        it('passes the same safelist entries the guard hard-codes', () => {
            // Anchored per line: an explanatory comment mentioning an entry name
            // must not be able to satisfy this.
            expect(safelistFromConfig()).toEqual([
                '/^ivp-token-/',
                '/^step-/',
                "'toggled-off'",
                "'btn-bounce'",
                "'expanded'",
            ]);
        });

        it('has no unmodelled :lang() safelist entry', () => {
            expect(safelistFromConfig().some((entry) => entry.includes(':lang'))).toBe(false);
        });
    });

    describe('guard sanity', () => {
        it('index.html still contains the id the heading selectors key on', () => {
            // Pin the premise of the :lang() rules surviving: `#root` is an id
            // PurgeCSS can find in the content string.
            expect(INDEX_HTML).toMatch(/<div id="root"/);
        });

        it('this app has no :lang() selector outside the brand heading rules', () => {
            // Block comments are stripped first: they explain the rules and quote
            // `:lang(x)` in prose, but they are not selectors.
            const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
            const langSelectors = [...css.matchAll(/(^|[\s,{])(:lang\([^)]*\))/g)].map((m) => m[2]);
            expect(langSelectors.length).toBeGreaterThan(0);
            for (const selector of langSelectors) {
                // ':lang(' is six characters.
                expect(Object.keys(LANG_HEADING_FONTS)).toContain(selector.slice(6, -1));
            }
        });

        it('every heading selector nests its type selectors inside :is()', () => {
            // purgecss auto-keeps nodes parented by a pseudo. If a rule were ever
            // written as `#root h2:lang(hi)` instead, `h2` would be a bare tag
            // node that the content set may not contain.
            const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
            for (const match of css.matchAll(/#root [^{]*:lang\([^)]*\)[^{]*\{/g)) {
                expect(match[0]).toContain(':is(h1, h2, h3)');
            }
        });
    });
});
