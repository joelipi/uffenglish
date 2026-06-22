// idiom-worker.js
// Off-main-thread builder for the idiom lookup dictionary.
// This keeps the heavy JSON parse + normalization off the main thread so the
// first simple video can mount and play while the dictionary is prepared.

import idiomsData from '../data/idioms.json';
import { normalizeText } from '../modules/utils/idiom-normalizer.js';

function buildDictionary() {
    const idiomSet = new Set();
    let maxWords = 0;
    let skippedWords = 0;

    const addPhrase = (phrase) => {
        if (!phrase) return;
        const cleaned = normalizeText(phrase);
        if (!cleaned) return;

        const wordCount = cleaned.split(' ').length;

        // PREVENT BUG: Ignore any single-word entries in the JSON
        if (wordCount < 2) {
            skippedWords++;
            return;
        }

        idiomSet.add(cleaned);

        if (wordCount > maxWords) {
            maxWords = wordCount;
        }
    };

    for (const entry of idiomsData.dictionary) {
        addPhrase(entry.phrase);
        if (Array.isArray(entry.patterns)) {
            entry.patterns.forEach(addPhrase);
        }
    }

    return { phrases: Array.from(idiomSet), maxWords, skippedWords };
}

const result = buildDictionary();
self.postMessage({ type: 'ready', ...result });
