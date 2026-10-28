import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HERO_RELATIONS } from '../../modules/home/hero-headline-logic.js';

// Static guard for the public homepage's marketing sections + carousel wiring.
// The components pull in the router/asset graph, so this locks the wiring by raw
// source. Every slice is scoped to a specific block (AGENTS.md) — never whole-file
// for a property that could match more than one place — and asserts on raw source.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const homeLanding = read('./HomeLanding.jsx');
const heroHeadlineComponent = read('./HeroHeadline.jsx');
const heroHeadlineLogic = read('../../modules/home/hero-headline-logic.js');
const heroHeadlineWebonly = read('../../modules/home/hero-headline-webonly.js');
const container = read('./HomeLandingContainer.jsx');
const carousel = read('./ConversationCarousel.jsx');
const showcaseVideos = read('../../modules/video/showcase-videos.js');
const homeLandingCss = read('./home-landing.css');
const scopedBootstrap = read('../../generated/homepage-bootstrap.css');
const videoPlayIcon = read('../VideoPlayIcon.jsx');
const simplePlayer = read('../SimpleVideoPlayer.web.jsx');
const interactivePlayer = read('../InteractiveVideoPlayer.web.jsx');

describe('HomeLanding app-matched styling + scroll contract', () => {
    it('reuses the app brand gradient token', () => {
        expect(homeLandingCss).toContain('linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)');
    });

    it('applies the main app palette through the Bootstrap theme variables', () => {
        expect(homeLandingCss).toContain('--bs-body-bg: #0b1a2a');
        expect(homeLandingCss).toContain('--bs-card-bg: #1a3a5a');
        expect(homeLandingCss).toContain('--bs-border-color: #2a4a6a');
        expect(homeLandingCss).toContain('--bs-secondary-color: #ffffff');
    });

    it('lifts the 9:16 phone frame on desktop for this page only', () => {
        const at = homeLandingCss.indexOf('#root:has(> .uff-home-bs)');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        for (const prop of ['aspect-ratio', 'width', 'height', 'border-radius', 'max-width']) {
            expect(block, prop).toContain(prop);
        }
    });

    it('preserves every existing share-code testid', () => {
        // The card renders twice (hero + bottom repeat) via a `suffix`, so the
        // testids are template literals; both copies must exist.
        for (const base of ['share-code-card', 'share-code-subheadline', 'share-code-input', 'share-code-go', 'share-code-error', 'no-code']) {
            expect(homeLanding, base).toContain(`data-testid={\`${base}\${suffix}\`}`);
        }
        expect(homeLanding).toContain('<ShareCodeCta {...ctaProps} suffix="-bottom"');
        for (const testid of ['landing-account-link']) {
            expect(homeLanding, testid).toContain(`data-testid="${testid}"`);
        }
    });

    it('stays opaque (never adds the lesson water surface)', () => {
        expect(homeLanding).not.toContain('water-surface');
        expect(homeLandingCss).not.toContain('water-surface');
    });

    it('renders the no-code action as a real type="button" button', () => {
        const at = homeLanding.indexOf('`no-code${suffix}`');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="button"');
    });

    it('keeps the Go action a type="submit" button', () => {
        const at = homeLanding.indexOf('`share-code-go${suffix}`');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="submit"');
    });

    it('styles the Go button white like the app call buttons, never gradient', () => {
        const at = homeLandingCss.indexOf('.uff-home-bs .btn-uff-primary {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('var(--uff-btn-bg)');
        expect(block).not.toContain('linear-gradient');
    });

    it('keeps the top-bar sign-in on a white solid button', () => {
        const at = homeLanding.indexOf('data-testid="landing-account-link"');
        expect(at).toBeGreaterThan(-1);
        const tagEnd = homeLanding.indexOf('>', at);
        expect(tagEnd).toBeGreaterThan(at);
        expect(homeLanding.slice(at, tagEnd)).toContain('btn-uff-topbar');
        const cssAt = homeLandingCss.indexOf('.uff-home-bs .btn-uff-topbar {\n    background-color: var(--uff-btn-bg);');
        expect(cssAt).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(cssAt, homeLandingCss.indexOf('}', cssAt));
        expect(block).toContain('var(--uff-btn-bg)');
        expect(block).toContain('#0b1a2a');
    });

    it('sizes showcase media portrait 9:16 and caps it for desktop', () => {
        const at = homeLandingCss.indexOf('.uff-carousel-media {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('9 / 16');
        expect(block).toContain('max-width');
        expect(block).toContain('39.375vh');
        expect(block).not.toContain('max-height:');
        expect(block).not.toContain('16 / 10');
    });

    it('caps the showcase card so the desktop block stays compact', () => {
        const at = homeLandingCss.indexOf('.uff-showcase-card {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('max-width');
        expect(carousel).toContain('uff-showcase-card');
    });
});

describe('HomeLanding rotating hero headline', () => {
    it('mounts the rotating headline inside the hero h1', () => {
        expect(homeLanding).toContain("import HeroHeadline from './HeroHeadline.jsx'");
        const at = homeLanding.indexOf('data-testid="share-code-headline"');
        expect(at).toBeGreaterThan(-1);
        const heading = homeLanding.slice(at, homeLanding.indexOf('</h1>', at));
        expect(heading).toContain('<HeroHeadline lang={lang} />');
    });

    it('no longer reads the retired plain headline or its subheading', () => {
        // The rotating sentence states both facts the subheading used to carry
        // (the level difference and "not online at the same time"), so the keys
        // are gone from strings.js and nothing may read them again.
        for (const key of ['home_landing_headline', 'home_landing_headline_sub']) {
            expect(homeLanding, key).not.toContain(key);
        }
    });

    it('renders both pills above the headline, from the strings table', () => {
        const pills = homeLanding.indexOf('data-testid="hero-pills"');
        const heading = homeLanding.indexOf('data-testid="share-code-headline"');
        expect(pills).toBeGreaterThan(-1);
        expect(pills).toBeLessThan(heading);
        expect(homeLanding).toContain("Strings.get('home_landing_pill_free', lang)");
        expect(homeLanding).toContain("Strings.get('home_landing_pill_no_zoom', lang)");
    });
});

describe('hero headline logic module purity', () => {
    it('carries no React and touches no DOM', () => {
        expect(heroHeadlineLogic).not.toMatch(/from ['"]react/);
        expect(heroHeadlineLogic).not.toContain('window.');
        expect(heroHeadlineLogic).not.toContain('document.');
    });

    it('keeps the browser read in the web-only module', () => {
        // eslint's browser-only rule plus this guard: the renderer and the pure
        // module never name `window`, the `-webonly` module does.
        expect(heroHeadlineComponent).not.toContain('window.');
        expect(heroHeadlineComponent).toContain("from '../../modules/home/hero-headline-webonly.js'");
        expect(heroHeadlineWebonly).toContain('typeof window');
    });

    it('leaves the copy, the word lists and the interval to the module', () => {
        expect(heroHeadlineComponent)
            .toContain("from '../../modules/home/hero-headline-logic.js'");
        // No localized copy and no CEFR band in the renderer: it only maps what
        // the module resolved.
        expect(heroHeadlineComponent).not.toContain('your mom');
        expect(heroHeadlineComponent).not.toContain('A0');
        expect(heroHeadlineComponent).not.toContain("'(prefers-reduced-motion");
    });
});

describe('rotating hero headline styling', () => {
    const block = (selector) => {
        const at = homeLandingCss.indexOf(selector);
        expect(at, `missing ${selector}`).toBeGreaterThan(-1);
        return homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
    };

    it('underlines the rotating words in the app brand accent', () => {
        const rot = block('.uff-hero-rot {');
        for (const prop of [
            'text-decoration-line: underline',
            'text-decoration-color: #00c0d8',
            'text-decoration-thickness',
            'text-underline-offset',
            'text-decoration-skip-ink: none',
        ]) {
            expect(rot, prop).toContain(prop);
        }
    });

    it('stacks the candidates in one centred grid cell so the line cannot reflow', () => {
        // The cell is as wide as the LONGEST candidate: that keeps the share-code
        // card below from moving, and centring pads a shorter word on both sides
        // instead of leaving a hole to one side.
        const rot = block('.uff-hero-rot {');
        expect(rot).toContain('display: inline-grid');
        expect(rot).toContain('justify-items: center');
        expect(rot).toContain('max-width: 100%');
        const item = block('.uff-hero-rot__item {');
        expect(item).toContain('grid-area: 1 / 1');
        expect(item).toContain('opacity: 0');
        expect(block('.uff-hero-rot__item.is-on')).toContain('opacity: 1');
        expect(heroHeadlineComponent).toContain('segment.values.map((value, valueIndex)');
    });

    it('keeps every relationship short enough for the cell', () => {
        // A multi-word value made the cell two thirds of a phone line and pushed
        // the word onto its own line (measured at 320/390px), so the lists are
        // single short words plus the possessive.
        for (const [lang, relations] of Object.entries(HERO_RELATIONS)) {
            for (const relation of relations) {
                expect(relation.split(' ').length, `${lang}: ${relation}`).toBeLessThanOrEqual(2);
                expect(relation.length, `${lang}: ${relation}`).toBeLessThanOrEqual(16);
            }
        }
    });

    it('drops the fade under prefers-reduced-motion', () => {
        const at = homeLandingCss.indexOf('@media (prefers-reduced-motion: reduce) {');
        expect(at).toBeGreaterThan(-1);
        const media = homeLandingCss.slice(at, homeLandingCss.indexOf('\n}', at));
        expect(media).toContain('.uff-hero-rot__item {');
        expect(media).toContain('transition: none');
    });

    it('never copies the marketing sample palette', () => {
        // The sample page's greens/greys must not leak into the app's palette.
        for (const colour of ['#0a0c11', '#7cf5a8', '#98a2b3']) {
            expect(homeLandingCss, colour).not.toContain(colour);
        }
    });

    it('styles the pills from the app palette, not the sample', () => {
        const pills = block('.uff-hero-pill {');
        expect(pills).toContain('border-radius: 999px');
        expect(pills).toContain('var(--bs-border-color)');
        expect(block('.uff-hero-pill--accent')).toContain('#00c0d8');
    });
});

describe('Bootstrap 5.3.8 is scoped to the homepage', () => {
    it('imports the scoped stylesheet and the homepage palette from HomeLanding', () => {
        expect(homeLanding).toContain("import '../../generated/homepage-bootstrap.css'");
        expect(homeLanding).toContain("import './home-landing.css'");
    });

    it('renders exactly one scoped homepage root', () => {
        // The scope class appears once in the source: the outermost wrapper.
        // Any extra occurrence (a comment, a second element) would leak.
        expect(homeLanding.split('uff-home-bs').length - 1).toBe(1);
        expect(homeLanding).toContain('className="uff-home-bs"');
    });

    it('no other file under src imports un-scoped Bootstrap or the scoped sheet', () => {
        // Repo-wide guard: real Bootstrap CSS is loaded only through the
        // homepage's scoped copy, never straight from node_modules.
        const UN_SCOPED_IMPORT = /import\s+['"]bootstrap\//;
        const SRC = path.join(__dirname, '../../..', 'src');
        const files = [];
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                // Guards themselves assert on source; only app modules count.
                else if (/\.(js|jsx|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
            }
        };
        walk(SRC);
        const read2 = (f) => readFileSync(f, 'utf8');
        const offenders = files.filter((f) => UN_SCOPED_IMPORT.test(read2(f)));
        expect(offenders.map((f) => path.relative(SRC, f)).sort()).toEqual([]);

        // Only the homepage imports Bootstrap, and only through the scoped copy.
        const SCOPED_IMPORT = "import '../../generated/homepage-bootstrap.css'";
        const importers = files.filter((f) => read2(f).includes(SCOPED_IMPORT));
        expect(importers.map((f) => path.relative(SRC, f)).sort())
            .toEqual(['components/homescreen/HomeLanding.jsx']);
    });

    it('keeps the generated Bootstrap sheet scoped and root-free', () => {
        expect(scopedBootstrap.startsWith('.uff-home-bs,')).toBe(true);
        expect(scopedBootstrap).toContain('.uff-home-bs .container');
        expect(scopedBootstrap).toContain('.uff-home-bs .btn');
        expect(scopedBootstrap).not.toContain('@charset');
        expect(scopedBootstrap).not.toContain('The Bootstrap Authors');
        expect(scopedBootstrap).not.toMatch(/(^|[},])\s*(html|body)\s*[,{]/);
        expect(scopedBootstrap).not.toMatch(/(^|[}=;])\s*:root\s*[,{]/);
    });
});

describe('HomeLanding teacher photo', () => {
    it('imports the teacher portrait asset', () => {
        expect(homeLanding).toContain("from '../../assets/img/teacherprofile.webp'");
    });

    it('hardcodes the teacher name as a module constant', () => {
        expect(homeLanding).toContain('Joe Walsh');
    });
});

describe('HomeLanding language selector', () => {
    it('imports HOME_LANGUAGES from the shared languages data', () => {
        expect(homeLanding).toContain("import { HOME_LANGUAGES } from '../../data/languages.js'");
    });

    it('renders a language selector wired to onLanguageChange', () => {
        expect(homeLanding).toContain('data-testid="landing-language-select"');
        expect(homeLanding).toContain('onLanguageChange');
    });
});

describe('HomeLandingContainer language + carousel wiring', () => {
    it('routes the selector through setGuestLanguageSilent', () => {
        expect(container).toContain('setGuestLanguageSilent(');
        expect(container).toContain('onLanguageChange');
    });

    it('builds the showcase list from buildShowcaseVideos', () => {
        expect(container).toContain('buildShowcaseVideos(');
    });
});

describe('showcase-videos module', () => {
    it('resolves URLs through the shared video-url builders', () => {
        expect(showcaseVideos).toContain('getPermanentVideoUrl');
        expect(showcaseVideos).toContain('getPermanentPosterUrl');
        expect(showcaseVideos).toContain("from './video-url.js'");
    });
});

describe('ConversationCarousel poster-first contract', () => {
    it('renders the carousel section', () => {
        expect(carousel).toContain('data-testid="showcase-carousel"');
    });

    it('mounts the video element only inside the play branch', () => {
        const playAt = carousel.indexOf('playingSlug === v.slug');
        const videoAt = carousel.indexOf('<video');
        expect(playAt).toBeGreaterThan(-1);
        expect(videoAt).toBeGreaterThan(-1);
        expect(videoAt).toBeGreaterThan(playAt);
        expect((carousel.match(/<video/g) || []).length).toBe(1);
    });

    it('stays opaque (never adds the lesson water surface)', () => {
        expect(carousel).not.toContain('water-surface');
    });

    it('renders the shared play triangle, not a copied path', () => {
        expect(carousel).toContain("import VideoPlayIcon from '../VideoPlayIcon.jsx'");
        expect(carousel).toContain('<VideoPlayIcon');
        expect(carousel).not.toContain('M8 5v14l11-7z');
    });
});

describe('VideoPlayIcon is the single play-triangle source', () => {
    it('holds the only copy of the triangle path', () => {
        expect(videoPlayIcon).toContain('M8 5v14l11-7z');
        for (const src of [carousel, simplePlayer, interactivePlayer]) {
            expect(src).not.toContain('M8 5v14l11-7z');
        }
    });

    it('is rendered by both video players', () => {
        for (const [name, src] of [['simple', simplePlayer], ['interactive', interactivePlayer]]) {
            expect(src, name).toContain("import VideoPlayIcon from './VideoPlayIcon.jsx'");
            expect(src, name).toContain('<VideoPlayIcon');
        }
    });
});
