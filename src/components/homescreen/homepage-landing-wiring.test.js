import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the public homepage's marketing sections + carousel wiring.
// The components pull in the router/asset graph, so this locks the wiring by raw
// source. Every slice is scoped to a specific block (AGENTS.md) — never whole-file
// for a property that could match more than one place — and asserts on raw source.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const homeLanding = read('./HomeLanding.jsx');
const container = read('./HomeLandingContainer.jsx');
const carousel = read('./ConversationCarousel.jsx');
const showcaseVideos = read('../../modules/video/showcase-videos.js');

describe('HomeLanding app-matched styling + scroll contract', () => {
    it('reuses the app brand gradient token', () => {
        expect(homeLanding).toContain('linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)');
    });

    it('preserves every existing share-code testid', () => {
        for (const testid of ['share-code-input', 'share-code-go', 'share-code-error', 'no-code', 'landing-account-link']) {
            expect(homeLanding, testid).toContain(`data-testid="${testid}"`);
        }
    });

    it('stays opaque (never adds the lesson water surface)', () => {
        expect(homeLanding).not.toContain('water-surface');
    });

    it('renders the no-code action as a real type="button" button', () => {
        const at = homeLanding.indexOf('data-testid="no-code"');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="button"');
    });

    it('keeps the Go action a type="submit" button', () => {
        const at = homeLanding.indexOf('data-testid="share-code-go"');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="submit"');
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
        expect(showcaseVideos).toContain('getVideoUrl');
        expect(showcaseVideos).toContain('getPosterUrl');
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
});
