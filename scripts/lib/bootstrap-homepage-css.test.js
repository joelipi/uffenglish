// scripts/lib/bootstrap-homepage-css.test.js
// Unit tests for scoping the vendored Bootstrap 5.3.8 stylesheet under one root
// class (the public homepage, story 059+). The invariant that matters: after
// scoping, NO selector of the real Bootstrap CSS can match anything outside the
// homepage subtree, so loading it never restyles the rest of the app.
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SCOPE_CLASS,
    DEFAULT_KEYFRAME_PREFIX,
    HOMEPAGE_BOOTSTRAP_VERSION,
    BOOTSTRAP_CSS_PATH,
    HOMEPAGE_BOOTSTRAP_CSS_PATH,
    stripComments,
    parseStatements,
    splitSelectorList,
    scopeSelector,
    scopeSelectorList,
    collectKeyframeNames,
    renameAnimationNames,
    scopeBootstrapCss,
    flattenedSelectors,
    isFullyScoped,
    readSourceBootstrapCss,
} from './bootstrap-homepage-css.js';

const SCOPE = DEFAULT_SCOPE_CLASS;

describe('scopeSelector', () => {
    it('replaces the document-root selectors with the scope class', () => {
        expect(scopeSelector(':root')).toBe(`.${SCOPE}`);
        expect(scopeSelector('html')).toBe(`.${SCOPE}`);
        expect(scopeSelector('body')).toBe(`.${SCOPE}`);
    });

    it('replaces html/body compound selectors with the scope class', () => {
        expect(scopeSelector('html:not(.x)')).toBe(`.${SCOPE}`);
        expect(scopeSelector('body.modal-open')).toBe(`.${SCOPE}`);
        expect(scopeSelector('body[data-x="1"]')).toBe(`.${SCOPE}`);
    });

    it('descendant-scopes ordinary selectors, keeping their shape', () => {
        expect(scopeSelector('.container')).toBe(`.${SCOPE} .container`);
        expect(scopeSelector('.row > *')).toBe(`.${SCOPE} .row > *`);
        expect(scopeSelector('::selection')).toBe(`.${SCOPE} ::selection`);
        expect(scopeSelector('a[href^="#"]')).toBe(`.${SCOPE} a[href^="#"]`);
    });

    it('descendant-scopes dark-theme attribute selectors', () => {
        expect(scopeSelector('[data-bs-theme=dark]')).toBe(`.${SCOPE} [data-bs-theme=dark]`);
    });

    it('honors a custom scope class', () => {
        expect(scopeSelector('.btn', 'foo')).toBe('.foo .btn');
    });
});

describe('scopeSelectorList', () => {
    it('scopes every selector of a comma list', () => {
        expect(scopeSelectorList('a, .btn, :root', SCOPE))
            .toBe(`.${SCOPE} a, .${SCOPE} .btn, .${SCOPE}`);
    });
});

describe('stripComments', () => {
    it('removes comments but not comment markers inside strings', () => {
        expect(stripComments('a/*x*/{color:red}/*y*/')).toBe('a{color:red}');
        expect(stripComments('a[data-x="a/*b*/c"]{content:"x/*y*/"}/*tail*/'))
            .toBe('a[data-x="a/*b*/c"]{content:"x/*y*/"}');
    });

    it('drops the Bootstrap banner', () => {
        const out = stripComments('/*! banner */:root{--x:1}');
        expect(out).toBe(':root{--x:1}');
    });
});

describe('parseStatements', () => {
    it('separates qualified rules, at-rules and nested blocks', () => {
        const out = parseStatements('@charset "UTF-8";a{color:red}@media (min-width:576px){.b{color:blue}}');
        expect(out).toHaveLength(3);
        expect(out[0]).toEqual({ prelude: '@charset "UTF-8"', atStatement: true });
        expect(out[1]).toEqual({ prelude: 'a', body: 'color:red' });
        expect(out[2]).toEqual({ prelude: '@media (min-width:576px)', body: '.b{color:blue}' });
    });

    it('does not break on braces inside strings or selectors', () => {
        const out = parseStatements('a[href^="#"]{content:"{"}[data-x="}"]{content:"}"}');
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ prelude: 'a[href^="#"]', body: 'content:"{"' });
        expect(out[1]).toEqual({ prelude: '[data-x="}"]', body: 'content:"}"' });
    });
});

describe('splitSelectorList', () => {
    it('splits on top-level commas only', () => {
        expect(splitSelectorList('a:not(.x, .y), .z[data=","] , .w'))
            .toEqual(['a:not(.x, .y)', '.z[data=","]', '.w']);
    });
});

describe('collectKeyframeNames', () => {
    it('maps every @keyframes name to the scoped name', () => {
        expect(collectKeyframeNames('@keyframes spinner-border{to{transform:rotate(1turn)}}@keyframes foo{from{opacity:0}}'))
            .toEqual(new Map([
                ['spinner-border', `${DEFAULT_KEYFRAME_PREFIX}-spinner-border`],
                ['foo', `${DEFAULT_KEYFRAME_PREFIX}-foo`],
            ]));
    });
});

describe('renameAnimationNames', () => {
    const map = new Map([['spinner-border', 'bs-spinner-border']]);

    it('rewrites the animation shorthand', () => {
        expect(renameAnimationNames('.x{animation:.75s linear infinite spinner-border}', map))
            .toBe('.x{animation:.75s linear infinite bs-spinner-border}');
    });

    it('rewrites animation-name only, leaving other declarations and selectors alone', () => {
        expect(renameAnimationNames('.spinner-border{color:red;animation-name:spinner-border}', map))
            .toBe('.spinner-border{color:red;animation-name:bs-spinner-border}');
    });

    it('is a no-op without a map', () => {
        expect(renameAnimationNames('.x{animation:spin 1s}')).toBe('.x{animation:spin 1s}');
    });
});

describe('scopeBootstrapCss', () => {
    it('scopes simple rules', () => {
        expect(scopeBootstrapCss('a, .btn{color:red}', { scopeClass: 's' }))
            .toBe('.s a, .s .btn{color:red}\n');
    });

    it('turns the root variable blocks into scope-class rules', () => {
        const out = scopeBootstrapCss(':root, [data-bs-theme=light]{--bs-primary:#0d6efd}', { scopeClass: 's' });
        // :root collapses onto the scope element; the companion attribute selector
        // stays a descendant so a nested [data-bs-theme] still overrides it.
        expect(out).toBe('.s, .s [data-bs-theme=light]{--bs-primary:#0d6efd}\n');
    });

    it('maps html/body reboot rules onto the scope element', () => {
        expect(scopeBootstrapCss('body{margin:0}html{-webkit-text-size-adjust:100%}', { scopeClass: 's' }))
            .toBe('.s{margin:0}.s{-webkit-text-size-adjust:100%}\n');
    });

    it('keeps the prelude of conditional group rules and scopes their contents', () => {
        expect(scopeBootstrapCss('@media (min-width:576px){.container{max-width:540px}}', { scopeClass: 's' }))
            .toBe('@media (min-width:576px){.s .container{max-width:540px}}\n');
    });

    it('scopes root rules nested inside a media query', () => {
        expect(scopeBootstrapCss('@media (prefers-reduced-motion:no-preference){:root{scroll-behavior:smooth}}', { scopeClass: 's' }))
            .toBe('@media (prefers-reduced-motion:no-preference){.s{scroll-behavior:smooth}}\n');
    });

    it('drops @charset', () => {
        expect(scopeBootstrapCss('@charset "UTF-8";a{color:red}', { scopeClass: 's' }))
            .toBe('.s a{color:red}\n');
    });

    it('renames keyframes and their animation references together', () => {
        const out = scopeBootstrapCss(
            '.spinner-border{animation:.75s linear infinite spinner-border}@keyframes spinner-border{to{transform:rotate(360deg)}}',
            { scopeClass: 's' },
        );
        expect(out).toContain('.s .spinner-border{animation:.75s linear infinite bs-spinner-border}');
        expect(out).toContain('@keyframes bs-spinner-border{to{transform:rotate(360deg)}}');
        expect(out).not.toContain('infinite spinner-border}');
    });

    it('rewrites the animation-name custom property Bootstrap 5.3.8 uses', () => {
        const out = scopeBootstrapCss(
            ':root{--bs-spinner-animation-name: spinner-border;--bs-spinner-animation-speed: .75s}'
            + '@keyframes spinner-border{to{transform:rotate(360deg)}}'
            + '.spinner-border{animation: var(--bs-spinner-animation-speed) linear infinite var(--bs-spinner-animation-name)}',
            { scopeClass: 's' },
        );
        expect(out).toContain('.s{--bs-spinner-animation-name: bs-spinner-border;');
        expect(out).toContain('--bs-spinner-animation-speed: .75s');
        expect(out).toContain('animation: var(--bs-spinner-animation-speed) linear infinite var(--bs-spinner-animation-name)}');
        expect(out).toContain('@keyframes bs-spinner-border');
    });

    it('is deterministic', () => {
        const css = ':root{--x:1}.a{b:c}@media print{.d{e:f}}@keyframes g{}';
        expect(scopeBootstrapCss(css, { scopeClass: 's' })).toBe(scopeBootstrapCss(css, { scopeClass: 's' }));
    });

    it('does not mis-parse braces inside string values', () => {
        const out = scopeBootstrapCss('a[href^="#"]{content:"{"}[data-x="}"]{color:red}', { scopeClass: 's' });
        expect(out).toContain('.s a[href^="#"]{content:"{"}');
        expect(out).toContain('.s [data-x="}"]{color:red}');
    });
});

describe('flattenedSelectors / isFullyScoped', () => {
    it('unwraps group at-rules and reports every qualified rule', () => {
        expect(flattenedSelectors('a{b:c}@media (min-width:0){.d{e:f}}')).toEqual(['a', '.d']);
    });

    it('rejects a stylesheet with an unscoped selector', () => {
        expect(isFullyScoped('.s .a{b:c}\nbody{d:e}')).toBe(false);
    });

    it('accepts a fully scoped stylesheet', () => {
        expect(isFullyScoped(`.${SCOPE}{--x:1}.${SCOPE} .a{b:c}.${SCOPE} .d e{f:g}`)).toBe(true);
    });
});

describe('the vendored Bootstrap 5.3.8 stylesheet', () => {
    const css = readSourceBootstrapCss(process.cwd());

    it('is the pinned version', () => {
        expect(HOMEPAGE_BOOTSTRAP_VERSION).toBe('5.3.8');
        expect(css).toMatch(new RegExp(`Bootstrap\\s+v${HOMEPAGE_BOOTSTRAP_VERSION.replace(/\./g, '\\.')} \\(https://getbootstrap\\.com/\\)`));
        expect(BOOTSTRAP_CSS_PATH).toBe('node_modules/bootstrap/dist/css/bootstrap.min.css');
        expect(HOMEPAGE_BOOTSTRAP_CSS_PATH).toBe('src/generated/homepage-bootstrap.css');
    });

    it('scopes every selector of the real Bootstrap CSS, including keyframes', () => {
        const scoped = scopeBootstrapCss(css);
        expect(isFullyScoped(scoped)).toBe(true);
        expect(scoped).toContain(`@keyframes ${DEFAULT_KEYFRAME_PREFIX}-spinner-border`);
        expect(scoped).toContain(`@keyframes ${DEFAULT_KEYFRAME_PREFIX}-placeholder-wave`);
        // 5.3.8 references the animation through a custom property.
        expect(scoped).toContain(`--bs-spinner-animation-name:${DEFAULT_KEYFRAME_PREFIX}-spinner-border`);
    });

    it('keeps the Bootstrap grid, buttons and reboots inside the scope', () => {
        const scoped = scopeBootstrapCss(css);
        expect(scoped).toContain(`.${SCOPE} .container-fluid`);
        expect(scoped).toContain(`.${SCOPE} .col-lg-6`);
        expect(scoped).toContain(`.${SCOPE} .btn`);
        expect(scoped).toContain(`.${SCOPE} .form-select`);
        expect(scoped).toContain(`.${SCOPE} .navbar`);
        expect(scoped).toContain(`.${SCOPE} .list-group`);
        expect(scoped).toContain(`.${SCOPE} .row>*`);
        expect(scoped).toContain(`.${SCOPE} .d-none`);
    });

    it('leaves no top-level root selector, charset or banner comment behind', () => {
        const scoped = scopeBootstrapCss(css);
        expect(scoped).not.toContain('@charset');
        expect(scoped).not.toContain('The Bootstrap Authors');
        // The first statement is Bootstrap's variable block: `:root,[data-bs-theme=light]`
        // becomes the scope class plus its scoped dark-theme companion.
        expect(scoped.startsWith(`.${SCOPE},`)).toBe(true);
        expect(scoped).toContain(`.${SCOPE}{`); // the body reboot lands on the scope element
        expect(scoped).not.toMatch(/(^|[},])[^{}\n]*(^|[},])\s*:root\s*[,{]/);
        expect(scoped).not.toMatch(/(^|[},])\s*(html|body)\s*[,{]/);
    });
});
