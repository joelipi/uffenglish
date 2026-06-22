// idiom-checker.js

import { normalizeText } from './idiom-normalizer.js';

class IdiomChecker {
    constructor() {
        this.idiomSet = new Set();
        this.maxWords = 0; // Tracks the longest idiom to optimize the search window
        this.isReady = false;
        this.initPromise = null; // Lock to prevent multiple concurrent fetches
    }

    /**
     * Synchronously builds the Set from imported JSON. Used as a fallback when
     * the Web Worker path is unavailable (e.g. test environments).
     */
    async _loadSynchronously() {
        try {
            const { default: data } = await import('../../data/idioms.json');
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

                this.idiomSet.add(cleaned);

                if (wordCount > this.maxWords) {
                    this.maxWords = wordCount;
                }
            };

            data.dictionary.forEach(entry => {
                addPhrase(entry.phrase);
                if (Array.isArray(entry.patterns)) {
                    entry.patterns.forEach(addPhrase);
                }
            });

            this.isReady = true;
            console.log(`[IdiomChecker] Synchronous load complete: ${this.idiomSet.size} phrases, maxWords=${this.maxWords}`);
        } catch (error) {
            console.error("Failed to load idioms data:", error);
        }
    }

    /**
     * Instantiates the instant-lookup Set from the imported JSON.
     * Uses a promise lock so it's safe to call multiple times across different files.
     *
     * On platforms that support Web Workers, the heavy JSON parse + normalization
     * happens off the main thread so the first video can mount and play immediately.
     */
    async init() {
        if (this.isReady) return;

        // If an initialization is already in progress, wait for it to finish
        if (this.initPromise) return this.initPromise;

        //console.log("IdiomChecker: Starting initialization...");

        // Create the promise and assign it to the lock
        this.initPromise = (async () => {
            if (typeof Worker === 'undefined') {
                console.warn('[IdiomChecker] Web Workers not available, falling back to synchronous load.');
                return this._loadSynchronously();
            }

            try {
                const worker = new Worker(new URL('../../workers/idiom-worker.js', import.meta.url), { type: 'module' });

                await new Promise((resolve, reject) => {
                    worker.onmessage = (e) => {
                        if (e.data.type === 'ready') {
                            for (const phrase of e.data.phrases) {
                                this.idiomSet.add(phrase);
                            }
                            this.maxWords = e.data.maxWords;
                            this.isReady = true;
                            worker.terminate();
                            console.log(`[IdiomChecker] Worker load complete: ${this.idiomSet.size} phrases, maxWords=${this.maxWords}`);
                            resolve();
                        }
                    };
                    worker.onerror = (err) => {
                        console.error('[IdiomChecker] Worker error:', err);
                        worker.terminate();
                        reject(err);
                    };
                });
            } catch (error) {
                console.warn('[IdiomChecker] Worker failed, falling back to synchronous load:', error);
                return this._loadSynchronously();
            }
        })();

        return this.initPromise;
    }

    /**
     * Counts the number of idioms in a given text string.
     * Returns an integer (0, 1, 2, 3, etc.).
     */
    count(text) {
        if (!this.isReady) {
            console.warn("IdiomChecker not ready. Did you await idiomChecker.init()?");
            return 0;
        }

        if (!text || typeof text !== 'string') return 0;

        //console.log(`\n--- IdiomChecker: Analyzing new text ---`);
        //console.log(`Original text: "${text}"`);

        // Clean and split the input text into an array of words
        const normalizedString = normalizeText(text);
        //console.log(`Normalized string: "${normalizedString}"`);

        const words = normalizedString.split(' ').filter(w => w.length > 0);
        //console.log(`Word array:`, words);

        let idiomCount = 0;
        let i = 0;
        const foundIdioms = []; // Track the actual matched strings for logging

        while (i < words.length) {
            let matched = false;

            // Check the longest possible combinations first (greedy match)
            const maxLen = Math.min(this.maxWords, words.length - i);
            //console.log(`\n🔍 Checking at index ${i} (word: "${words[i]}")`);

            // Stop at len >= 2. An idiom must be at least 2 words.
            for (let len = maxLen; len >= 2; len--) {
                const candidate = words.slice(i, i + len).join(' ');
                //console.log(`  Testing candidate (${len} words): "${candidate}"`);

                if (this.idiomSet.has(candidate)) {
                    idiomCount++;
                    foundIdioms.push(candidate);

                    console.log(`  ✅ MATCH FOUND! "${candidate}" exists in the dictionary.`);
                    console.log(`  Counting as idiom #${idiomCount}. Jumping forward by ${len} words.`);

                    i += len; // Jump forward by the length of the matched idiom
                    matched = true;
                    break;    // Stop checking shorter combinations for this starting word
                }
            }

            // If no idiom starts with this word, move to the next single word
            if (!matched) {
                //console.log(`  ❌ No matches starting with "${words[i]}". Moving to next word.`);
                i++;
            }
        }

        console.log(`\n🏁 Total idioms found in text: ${idiomCount}`);
        if (idiomCount > 0) {
            console.log(`📝 Idioms matched:`, foundIdioms);
        }
        
        return { count: idiomCount, foundIdioms: foundIdioms };
    }
}

// Export a singleton instance so the Set only loads into memory once
export const idiomChecker = new IdiomChecker();