import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SUCCESS_SRT } from './success-step.web.js';
import { SUCCESS_VIDEO_FRIEND, SUCCESS_VIDEO_SINGLE_PLAYER } from './success-step-logic.js';

// The success captions are separate .srt files linked by success-step.web.js via
// Vite `?raw`. Guard the contract: both types, all four languages, real SRT shape.

// vitest runs from the repo root; avoid import.meta.url (jsdom rewrites it).
const ROOT = process.cwd();
const LANGS = ['en', 'es', 'pt', 'bn', 'fr'];
const TYPES = ['friend', 'single-player'];

// The SRT parser (simple-video-controller.js) splits blocks on blank lines and
// needs a `-->` timing line; mirror the essential shape here.
function looksLikeSrt(text) {
    if (typeof text !== 'string' || !text.includes('-->')) return false;
    const blocks = text.split(/\r?\n\s*\r?\n/).filter((b) => b.trim() !== '');
    if (blocks.length === 0) return false;
    return blocks.every((block) => /^\d+\s*$/m.test(block) && block.includes('-->'));
}

describe('success captions', () => {
    it('carries every type × language', () => {
        for (const type of TYPES) {
            expect(SUCCESS_SRT[type], `missing type ${type}`).toBeTruthy();
            for (const lang of LANGS) {
                expect(typeof SUCCESS_SRT[type][lang], `${type}.${lang}`).toBe('string');
                expect(SUCCESS_SRT[type][lang].length, `${type}.${lang}`).toBeGreaterThan(0);
            }
        }
    });

    it('every linked .srt parses as an SRT document', () => {
        for (const type of TYPES) {
            for (const lang of LANGS) {
                expect(looksLikeSrt(SUCCESS_SRT[type][lang]), `${type}.${lang}`).toBe(true);
            }
        }
    });

    it('the .srt files exist on disk under src/assets/subtitles/', () => {
        const slugFor = { friend: SUCCESS_VIDEO_FRIEND, 'single-player': SUCCESS_VIDEO_SINGLE_PLAYER };
        for (const type of TYPES) {
            for (const lang of LANGS) {
                const file = path.join(ROOT, 'src', 'assets', 'subtitles', `${slugFor[type]}.${lang}.srt`);
                expect(readFileSync(file, 'utf8').includes('-->'), `${type}.${lang}`).toBe(true);
            }
        }
    });
});

describe('success video slugs', () => {
    it('are the two canonical slugs', () => {
        expect(SUCCESS_VIDEO_FRIEND).toBe('friend-success');
        expect(SUCCESS_VIDEO_SINGLE_PLAYER).toBe('single-player-success');
    });
});

describe('success-step wiring', () => {
    it('AppLayout applies the success step after normalizing the config', () => {
        const src = readFileSync(path.join(ROOT, 'src', 'routes', 'AppLayout.jsx'), 'utf8');
        // The component calls the module (no inline rules). Injection must run
        // after normalizeConfig: the normalizer migrates legacy `questions` to
        // `steps`, which the injection needs to exist.
        expect(src).toContain("from '../modules/lesson/success-step.web.js'");
        expect(src.indexOf('normalizeConfig(')).toBeGreaterThan(-1);
        expect(src.indexOf('applySuccessSteps(')).toBeGreaterThan(src.indexOf('normalizeConfig('));
    });

    it('AppLayout keeps the UGC code registry current on every link change', () => {
        const src = readFileSync(path.join(ROOT, 'src', 'routes', 'AppLayout.jsx'), 'utf8');
        // The classifier matches the share codes in play (never the slug's
        // shape), so the registry must track link changes even when the config
        // is already loaded — a second friend link must not leave stale codes.
        expect(src).toContain("from '../modules/video/video-source.js'");
        expect(src).toContain('setKnownShareCodes([friendCode, userData?.shareCode])');
    });
});
