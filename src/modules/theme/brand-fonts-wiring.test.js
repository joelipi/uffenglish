import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    CSS_VARIABLES,
    LANG_HEADING_FONTS,
    UNIVERSAL_FALLBACK_FONTS,
    fontStack,
    googleFontsUrl,
    headLinkTags,
    langHeadingFontStack,
    langHeadingVariable,
    quoteFamily,
} from './brand-fonts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const INDEX_HTML = read('index.html');
const APP_CSS = read('src', 'assets', 'css', 'app.css');
const HOME_LANDING_CSS = read('src', 'components', 'homescreen', 'home-landing.css');

// Every assertion below runs on RAW source. A `/\/\/.*$/gm` comment stripper
// would eat the `//` in `https://fonts.googleapis.com` and blank the very URL
// these guards exist to check, so a stripped-source variant of any of them can
// never fail.
//
// The one exception is the *structural* helpers below, which strip `/* … */`
// block comments before locating a rule. Without that, an explanatory comment
// that quotes a selector (`the :lang(zh) rule wins`) makes `indexOf(':lang(zh)')`
// land inside the comment, and the guard then asserts against prose. Block
// comments cannot hold a declaration we want to assert on, so stripping them
// for structure is safe; every "must contain" assertion below still reads real
// CSS.
const withoutBlockComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

/** The single declaration block that starts at `marker`, ending at its `}`. */
function blockFor(source, marker) {
    const start = withoutBlockComments(source).indexOf(marker);
    expect(start, `no rule starts with ${JSON.stringify(marker)}`).toBeGreaterThan(-1);
    const end = withoutBlockComments(source).indexOf('}', start);
    expect(end, `${JSON.stringify(marker)} has no closing brace`).toBeGreaterThan(-1);
    return withoutBlockComments(source).slice(start, end + 1);
}

/** The value of `--name:` inside the `:root` block, trimmed. */
function rootVariableValue(source, name) {
    const root = blockFor(source, ':root {');
    const start = root.indexOf(`${name}:`);
    expect(start, `:root does not declare ${name}`).toBeGreaterThan(-1);
    return root.slice(start + name.length + 1).split(';')[0].trim();
}

/**
 * A single HTML tag, from `marker` to its closing `>`.
 *
 * A `<link>` has no `}`, so the brace-slicing helper would run past the tag and
 * swallow the next one plus a chunk of the inline <style> — which is how the
 * `crossorigin` guard below once "saw" the gstatic tag while asserting on the
 * googleapis one.
 */
function tagFor(source, marker) {
    const start = source.indexOf(marker);
    expect(start, `no tag starts with ${JSON.stringify(marker)}`).toBeGreaterThan(-1);
    const end = source.indexOf('>', start);
    expect(end, `${JSON.stringify(marker)} is not closed`).toBeGreaterThan(-1);
    return source.slice(start, end + 1);
}

/**
 * The whole rule containing `selectorToken`, including the start of a
 * multi-line selector list.
 *
 * Walking back to the previous `{`, `}` or comment terminator is what makes
 * this safe: a rule like
 *
 *   :is(h1, h2, h3):lang(zh-Hant), :is(h1, h2, h3):lang(zh-HK), … ,
 *   :is(h1, h2, h3) :lang(zh-Hant), … { font-family: … }
 *
 * would otherwise be sliced from the middle, and the guards below would only
 * ever see part of the selector list.
 */
function ruleFor(source, selectorToken) {
    const css = withoutBlockComments(source);
    const token = css.indexOf(selectorToken);
    expect(token, `no rule mentions ${JSON.stringify(selectorToken)}`).toBeGreaterThan(-1);

    const brace = css.indexOf('{', token);
    expect(brace, `${selectorToken} has no declaration block`).toBeGreaterThan(-1);

    let start = token;
    for (const boundary of ['{', '}']) {
        const at = css.lastIndexOf(boundary, token - 1);
        if (at > start) start = at + 1;
    }

    const end = css.indexOf('}', brace);
    expect(end, `${selectorToken} has no closing brace`).toBeGreaterThan(-1);
    return css.slice(start, end + 1).trim();
}

describe('brand fonts: index.html <head> wiring', () => {
    it('declares the exact stylesheet URL the module generates', () => {
        expect(INDEX_HTML).toContain(`<link rel="stylesheet" href="${googleFontsUrl()}">`);
    });

    it('preconnects both origins before the stylesheet', () => {
        const [googleapis, gstatic, stylesheet] = headLinkTags();
        const a = INDEX_HTML.indexOf(googleapis);
        const b = INDEX_HTML.indexOf(gstatic);
        const c = INDEX_HTML.indexOf(stylesheet);
        expect(a).toBeGreaterThan(-1);
        expect(b).toBeGreaterThan(-1);
        expect(c).toBeGreaterThan(-1);
        // Order is load-bearing: a preconnect after the stylesheet it is meant
        // to warm arrives too late to help.
        expect(a).toBeLessThan(c);
        expect(b).toBeLessThan(c);
    });

    it('keeps crossorigin on the gstatic preconnect only', () => {
        const gstatic = tagFor(INDEX_HTML, '<link rel="preconnect" href="https://fonts.gstatic.com"');
        const googleapis = tagFor(INDEX_HTML, '<link rel="preconnect" href="https://fonts.googleapis.com"');
        expect(gstatic).toContain('crossorigin');
        expect(googleapis).not.toContain('crossorigin');
    });

    it('keeps display=swap so text is never invisible while the fonts load', () => {
        expect(INDEX_HTML).toContain('&display=swap');
    });

    it('has exactly one font stylesheet link', () => {
        const links = INDEX_HTML.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/g) ?? [];
        expect(links).toHaveLength(1);
    });

    it('no longer loads the fonts twice (the old preload + noscript pair is gone)', () => {
        expect(INDEX_HTML).not.toMatch(/<link[^>]*rel="preload"[^>]*fonts\.googleapis/);
        expect(INDEX_HTML).not.toMatch(/<noscript><link[^>]*fonts\.googleapis/);
    });

    it('does not @import the fonts in app.css (a second, render-blocking fetch)', () => {
        // Line-anchored: an unanchored search matches the explanatory comment
        // above the stylesheet, which names the very at-rule being forbidden.
        expect(APP_CSS).not.toMatch(/^\s*@import\b/m);
        expect(withoutBlockComments(APP_CSS)).not.toMatch(/@import\b/);
    });

    it('the inline preloader stack matches the body stack', () => {
        // The inline <style> must paint before app.css and its :root variables
        // arrive, so it repeats the stack as a literal. If these drift the
        // preloader flashes a different font than the app. The rule is located
        // by its `body, html` selector rather than by its indentation, so a
        // reformat does not silently disarm this.
        const inline = ruleFor(INDEX_HTML, 'html {');
        expect(inline).toContain(`font-family: ${fontStack('Inter')};`);
    });
});

describe('brand fonts: app.css custom properties', () => {
    it('declares --font-body as Inter plus the universal tail', () => {
        expect(rootVariableValue(APP_CSS, CSS_VARIABLES.body)).toBe(fontStack('Inter'));
    });

    it('declares --font-heading as Titillium Web plus the universal tail', () => {
        expect(rootVariableValue(APP_CSS, CSS_VARIABLES.heading)).toBe(fontStack('Titillium Web'));
    });

    it('every body/heading stack ends in the generic family', () => {
        for (const name of [CSS_VARIABLES.body, CSS_VARIABLES.heading]) {
            expect(rootVariableValue(APP_CSS, name).endsWith('sans-serif')).toBe(true);
        }
    });

    it('both stacks carry the whole universal fallback tail', () => {
        for (const name of [CSS_VARIABLES.body, CSS_VARIABLES.heading]) {
            const value = rootVariableValue(APP_CSS, name);
            for (const fallback of UNIVERSAL_FALLBACK_FONTS) {
                expect(value).toContain(quoteFamily(fallback));
            }
        }
    });

    it.each(Object.keys(LANG_HEADING_FONTS))('declares the %s heading override', (lang) => {
        const variable = langHeadingVariable(lang);
        expect(rootVariableValue(APP_CSS, variable)).toBe(langHeadingFontStack(lang));
    });

    it('gives every :lang() override family the universal tail too', () => {
        for (const lang of Object.keys(LANG_HEADING_FONTS)) {
            const value = rootVariableValue(APP_CSS, langHeadingVariable(lang));
            for (const fallback of UNIVERSAL_FALLBACK_FONTS) {
                expect(value).toContain(quoteFamily(fallback));
            }
        }
    });
});

/**
 * Specificity of a single compound/complex selector as `[ids, classes, elements]`
 * (the CSS cascade compares these lexicographically).
 *
 * Handles what these rules actually use: id, class, attribute and pseudo-class
 * selectors, type selectors, the `>`/`+`/`~` combinators and `:is()`/`:not()`
 * (which take the specificity of their most specific argument). Pseudo-elements
 * count in the `elements` column, per the spec.
 */
function specificityOf(selector) {
    // `:is()` / `:not()` contribute the specificity of their most specific
    // argument. They are lifted out first so the placeholder can never also be
    // counted as a type selector.
    const groups = [...selector.matchAll(/:(?:is|not)\(([^()]*)\)/g)];
    const rest = selector.replace(/:(?:is|not)\([^()]*\)/g, ' ');

    let ids = 0;
    let classes = 0;
    let elements = 0;
    for (const [, args] of groups) {
        const best = args.split(',').map((arg) => specificityOf(arg));
        ids += Math.max(...best.map((b) => b[0]));
        classes += Math.max(...best.map((b) => b[1]));
        elements += Math.max(...best.map((b) => b[2]));
    }

    ids += (rest.match(/#[\w-]+/g) ?? []).length;
    classes += (rest.match(/\.[\w-]+/g) ?? []).length;
    classes += (rest.match(/\[[^\]]*\]/g) ?? []).length;
    classes += (rest.match(/:(?!:)[\w-]+/g) ?? []).length;
    elements += (rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    elements += (rest.match(/::[\w-]+/g) ?? []).length;
    return [ids, classes, elements];
}

/** Sanity-checked examples, so a future edit of the helper above is visible. */
describe('specificityOf', () => {
    it.each([
        ['h1', [0, 0, 1]],
        ['#root h1', [1, 0, 1]],
        ['.uff-home-bs h1', [0, 1, 1]],
        [':lang(hi)', [0, 1, 0]],
        [':is(h1, h2, h3)', [0, 0, 1]],
        ['#root :is(h1, h2, h3):lang(hi)', [1, 1, 1]],
    ])('%s is %j', (selector, expected) => {
        expect(specificityOf(selector)).toEqual(expected);
    });

    it('splitSelectorList does not cut inside :is()', () => {
        expect(splitSelectorList('#root :is(h1, h2, h3):lang(ja), #root :is(h1, h2, h3) :lang(ja)'))
            .toEqual(['#root :is(h1, h2, h3):lang(ja)', '#root :is(h1, h2, h3) :lang(ja)']);
        expect(splitSelectorList('#root h1, #root h2, #root h3'))
            .toEqual(['#root h1', '#root h2', '#root h3']);
    });
});

/**
 * Split a selector list on commas that are NOT inside parentheses, so
 * `:is(h1, h2, h3):lang(hi)` stays one selector instead of being cut in half.
 */
function splitSelectorList(selectorText) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const char of selectorText) {
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/** The first selector of the rule at `marker`. */
function firstSelectorOf(source, marker) {
    return splitSelectorList(blockFor(source, marker).split('{')[0])[0];
}

/**
 * The cascade's comparison of two specificities: positive when `a` wins,
 * negative when `b` wins, 0 on a tie. Columns are compared left to right, so an
 * id outranks any number of classes.
 */
function compareSpecificity(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

describe('brand fonts: heading rules', () => {
    it('applies the display face to h1/h2/h3 in italic', () => {
        const rule = blockFor(APP_CSS, '#root h1, #root h2, #root h3 {');
        expect(rule).toContain(`font-family: var(${CSS_VARIABLES.heading})`);
        expect(rule).toMatch(/font-style:\s*italic/);
    });

    it('uses the 900 face for h1 and 700 for h2/h3', () => {
        expect(blockFor(APP_CSS, '#root h1 {')).toMatch(/font-weight:\s*900/);
        expect(blockFor(APP_CSS, '#root h1, #root h2, #root h3 {')).toMatch(/font-weight:\s*700/);
    });

    it('outranks the homepage Bootstrap reboot heading weight', () => {
        // The homepage loads scoped Bootstrap 5.3.8, whose reboot sets
        // `.uff-home-bs h1, … h6 { font-weight: 500 }` and loads AFTER app.css.
        // A bare `h1` selector would lose and leave every homepage heading at
        // 500, so the brand rule is anchored to #root.
        const scopedBootstrap = read('src', 'generated', 'homepage-bootstrap.css');
        const bootstrapRule = blockFor(scopedBootstrap, '.uff-home-bs h1, .uff-home-bs h2');
        expect(bootstrapRule).toMatch(/font-weight:\s*500/);

        const bootstrap = specificityOf(firstSelectorOf(scopedBootstrap, '.uff-home-bs h1, .uff-home-bs h2'));
        const brand = specificityOf(firstSelectorOf(APP_CSS, '#root h1, #root h2, #root h3 {'));

        expect(bootstrap).toEqual([0, 1, 1]);
        expect(brand).toEqual([1, 0, 1]);
        // The cascade compares these column by column, so the id wins.
        expect(compareSpecificity(brand, bootstrap)).toBeGreaterThan(0);
    });

    it('body uses the body variable, not a hardcoded stack', () => {
        const rule = blockFor(APP_CSS, 'body {');
        expect(rule).toContain(`font-family: var(${CSS_VARIABLES.body})`);
    });

    it('does not style any heading level the kit does not target', () => {
        // h4-h6 must not pick up the display treatment. Scanning the selector
        // lists (rather than matching `h4` against a character class) is what
        // makes this able to fail: the brand rules are anchored to `#root`, so
        // a naive `^[#\w.]*h4` pattern would never match `#root h4 {`.
        const css = withoutBlockComments(APP_CSS);
        const selectorLists = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
        const headingSelectors = [];
        for (const list of selectorLists) {
            for (const selector of splitSelectorList(list)) {
                // Only the last compound can be the subject of the selector.
                const subject = selector.split(/[\s>+~]/).pop() ?? '';
                if (/^h[1-6]$/.test(subject)) headingSelectors.push(selector);
            }
        }

        // Exactly the brand rules (the h1/h2/h3 group plus h1's 900 override),
        // and nothing targeting h4-h6.
        expect(headingSelectors).toEqual(['#root h1', '#root h2', '#root h3', '#root h1']);
    });
});

describe('brand fonts: :lang() heading overrides', () => {
    it('swaps the heading face for Japanese', () => {
        expect(ruleFor(APP_CSS, ':lang(ja)')).toContain(
            `font-family: var(${langHeadingVariable('ja')})`
        );
    });

    it('swaps the heading face for Chinese', () => {
        expect(ruleFor(APP_CSS, ':lang(zh)')).toContain(
            `font-family: var(${langHeadingVariable('zh')})`
        );
    });

    it('swaps the heading face for Hindi', () => {
        expect(ruleFor(APP_CSS, ':lang(hi)')).toContain(
            `font-family: var(${langHeadingVariable('hi')})`
        );
    });

    it('swaps the heading face for Bengali', () => {
        expect(ruleFor(APP_CSS, ':lang(bn)')).toContain(
            `font-family: var(${langHeadingVariable('bn')})`
        );
    });

    it.each(['zh-Hant', 'zh-HK', 'zh-TW'])('routes %s to the traditional Chinese face', (subtag) => {
        expect(ruleFor(APP_CSS, `:lang(${subtag})`)).toContain(
            `font-family: var(${langHeadingVariable('zh-Hant')})`
        );
    });

    it('covers a localized span inside a heading, not just the heading itself', () => {
        // This app renders translations as <span lang="…"> inside headings, and
        // those spans inherit font-family from the heading, so matching only
        // `:lang(x) h1` would leave them on the OS face.
        for (const lang of ['ja', 'zh', 'hi', 'bn']) {
            expect(ruleFor(APP_CSS, `#root :is(h1, h2, h3) :lang(${lang})`)).toBeTruthy();
            expect(ruleFor(APP_CSS, `:lang(${lang})`)).toContain(
                `#root :is(h1, h2, h3) :lang(${lang})`
            );
        }
    });

    it.each(['ja', 'zh', 'hi', 'bn'])(
        'the :lang(%s) rule outranks the plain heading rule',
        (lang) => {
            // `#root h1, … ` is (1,0,1) and an id outranks any number of
            // pseudo-classes, so an unanchored `:lang()` rule — (0,1,1), since
            // `:is(h1, h2, h3)` contributes one type — would lose, and a heading
            // that is itself in that language would keep the Latin face.
            // Anchored, the override is (1,1,1) and wins on the class column.
            const base = specificityOf(firstSelectorOf(APP_CSS, '#root h1, #root h2, #root h3 {'));
            const override = specificityOf(
                firstSelectorOf(APP_CSS, `#root :is(h1, h2, h3):lang(${lang})`)
            );
            expect(base).toEqual([1, 0, 1]);
            expect(override).toEqual([1, 1, 1]);
            expect(compareSpecificity(override, base)).toBeGreaterThan(0);
        }
    );

    it('orders the traditional Chinese rule AFTER the generic zh rule', () => {
        // `:lang(zh)` also matches zh-Hant/zh-HK/zh-TW. Both rules have equal
        // specificity, so only source order keeps the traditional face winning.
        const generic = APP_CSS.indexOf(':lang(zh),');
        const traditional = APP_CSS.indexOf(':lang(zh-Hant),');
        expect(generic).toBeGreaterThan(-1);
        expect(traditional).toBeGreaterThan(-1);
        expect(generic).toBeLessThan(traditional);
    });

    it('leaves font-style to the existing [lang] italic rules', () => {
        // The app italicises localized strings globally and opts video overlays
        // back out with `font-style: normal !important`. Re-declaring font-style
        // in these rules would fight both behaviours.
        for (const lang of ['ja', 'zh', 'hi', 'bn']) {
            expect(ruleFor(APP_CSS, `:lang(${lang})`)).not.toContain('font-style');
        }
    });
});

describe('brand fonts: no dead font references left in DOM typography', () => {
    const domSources = [
        'src/routes/AuthLayout.jsx',
        'src/components/auth/LoginForm.web.jsx',
        'src/components/auth/SignupForm.web.jsx',
        'src/components/auth/RecoverPasswordForm.web.jsx',
        'src/components/auth/ResetPasswordForm.web.jsx',
        'src/components/auth/ConfirmEmailForm.web.jsx',
        'src/components/courses/CourseListings.jsx',
        'src/components/friends/Friends.jsx',
        'src/components/legal/LegalPage.jsx',
        'src/components/profile/UserProfile.jsx',
        'src/components/profile/PublicProfile.jsx',
        'src/components/homescreen/HomeScreen.jsx',
        'src/components/notifications/PushNotificationsOptIn.web.jsx',
        'src/components/pwa/PWAInstallBanner.web.jsx',
    ];

    it.each(domSources)('%s names no unloaded font family', (relative) => {
        const source = read(...relative.split('/'));
        expect(source).not.toContain('Orbitron');
        expect(source).not.toContain('Plus Jakarta Sans');
    });

    it('no stylesheet hardcodes a font stack instead of the variables', () => {
        for (const relative of ['src/assets/css/app.css', 'src/components/homescreen/home-landing.css']) {
            const source = read(...relative.split('/'));
            const declarations = [...source.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
            const allowed = [
                `var(${CSS_VARIABLES.body})`,
                `var(${CSS_VARIABLES.heading})`,
                ...Object.keys(LANG_HEADING_FONTS).map(langHeadingVariable).map((v) => `var(${v})`),
                // The homepage's Bootstrap theme variable, which itself points
                // at var(--font-body) — checked separately below.
                'var(--bs-body-font-family)',
                '"bootstrap-icons"',
                'inherit',
            ];
            for (const declaration of declarations) {
                expect(allowed).toContain(declaration);
            }
        }
    });

    it('the homepage body font is the shared variable', () => {
        expect(HOME_LANDING_CSS).toContain(`--bs-body-font-family: var(${CSS_VARIABLES.body});`);
    });
});