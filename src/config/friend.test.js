import { describe, it, expect } from 'vitest';
import friend from './friend.json';

// friend.json is fetched at runtime (AppLayout.jsx) and localized through
// getLocalizedTranslation (src/modules/utils/utils.js), which silently falls
// back to English when the user's native-language key is missing. Bengali (bn)
// is a supported UI language (src/data/languages.js), so every authored
// translation object must carry a bn string or Bengali users get English.

const LOCALES = ['en', 'es', 'pt', 'bn'];

// Walks the config and returns every translation leaf: a plain object whose
// keys are all strings and include 'en'. Arrays (cue/subtitles lists) are
// traversed so their elements are checked too.
function collectTranslationObjects(node, path = '$', out = []) {
    if (Array.isArray(node)) {
        node.forEach((child, i) => collectTranslationObjects(child, `${path}[${i}]`, out));
        return out;
    }
    if (node && typeof node === 'object') {
        const keys = Object.keys(node);
        const isTranslation = keys.includes('en') && keys.every((k) => typeof node[k] === 'string');
        if (isTranslation) {
            out.push({ path, value: node });
        } else {
            for (const [key, child] of Object.entries(node)) {
                collectTranslationObjects(child, `${path}.${key}`, out);
            }
        }
    }
    return out;
}

describe('friend.json Bengali (bn) localization', () => {
    const translations = collectTranslationObjects(friend);

    it('finds the authored translation objects', () => {
        expect(translations.length).toBeGreaterThan(0);
    });

    it.each(translations.map(({ path, value }) => [path, value]))(
        'has a non-empty bn string at %s',
        (path, value) => {
            expect(value.bn, `${path} is missing bn`).toBeTypeOf('string');
            expect(value.bn.trim().length, `${path} has an empty bn string`).toBeGreaterThan(0);
        }
    );

    it('uses the same locale keys on every translation object', () => {
        for (const { path, value } of translations) {
            expect(Object.keys(value), `${path} locale keys`).toEqual(LOCALES);
        }
    });

    it('does not fall back to the English string for bn', () => {
        for (const { path, value } of translations) {
            expect(value.bn, `${path} bn duplicates en`).not.toBe(value.en);
        }
    });
});
