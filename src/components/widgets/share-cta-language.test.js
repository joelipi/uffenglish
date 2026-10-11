// src/components/widgets/share-cta-language.test.js
// Source guard for the friend-challenge success screen's call to action. The
// learner already picked their language, so `share_cta_success` renders the
// translation alone; the English sentence must not be printed above it (that is
// the bug this guards). `getBilingual()` still owns the English fallback, so an
// untranslated locale keeps working. Assertions are on raw source — a `//`
// stripper would also eat URLs (AGENTS.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const screen = read('./SuccessScreen.jsx');
const strings = read('../../data/strings.js');

// The paragraph that renders the CTA, from its opening tag to the paragraph's
// close, so the assertions cannot be satisfied by any other part of the file.
const PARAGRAPH_START = '<p className="success-share-cta">';
const paragraph = screen.slice(
    screen.indexOf(PARAGRAPH_START),
    screen.indexOf('</p>', screen.indexOf(PARAGRAPH_START))
);

describe('success-screen share CTA language rule', () => {
    it('renders only the translation, with the localized span kept', () => {
        expect(paragraph).not.toBe('');
        expect(paragraph).toContain('<span lang={cta.lang}>{cta.localized}</span>');
        expect(paragraph).not.toContain('{cta.english}');
        expect(paragraph).not.toContain('<br />');
        expect(paragraph).not.toContain('<React.Fragment>');
    });

    it('keeps English as the no-translation fallback', () => {
        expect(paragraph).toContain(': cta.english');
    });

    it('still resolves the language guest-first', () => {
        expect(screen).toMatch(/getBilingual\('share_cta_success', lang\)/);
        // The guest-first contract of guest-first-language.test.js for this file.
        expect(screen).toMatch(/useNativeLanguage/);
        expect(screen).not.toMatch(/userData\?\.native_language/);
    });

    it('ships the CTA copy in every supported language', () => {
        const block = strings.match(/'share_cta_success':\s*\{([\s\S]*?)\n\s*\},/);
        expect(block).toBeTruthy();
        for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
            expect(block[1]).toMatch(new RegExp(`\\b${lang}:`));
        }
    });
});
