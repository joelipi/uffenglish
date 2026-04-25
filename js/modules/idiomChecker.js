// idiomChecker.js

// --- Number-To-Words Utility (Scoped locally to avoid polluting global namespace) ---
const numberToWords = (function() {
    "use strict";
    var t=9007199254740991;
    function f(e){return!("number"!=typeof e||e!=e||e===1/0||e===-1/0)}
    function l(e){return"number"==typeof e&&Math.abs(e)<=t}
    var n=/(hundred|thousand|(m|b|tr|quadr)illion)$/,r=/teen$/,o=/y$/,i=/(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/,s={zero:"zeroth",one:"first",two:"second",three:"third",four:"fourth",five:"fifth",six:"sixth",seven:"seventh",eight:"eighth",nine:"ninth",ten:"tenth",eleven:"eleventh",twelve:"twelfth"};
    function h(e){return n.test(e)||r.test(e)?e+"th":o.test(e)?e.replace(o,"ieth"):i.test(e)?e.replace(i,a):e}
    function a(e,t){return s[t]}
    var u=10,d=100,p=1e3,v=1e6,b=1e9,y=1e12,c=1e15,g=9007199254740992,m=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"],w=["zero","ten","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
    function x(e,t){var n,r=parseInt(e,10);if(!f(r))throw new TypeError("Not a finite number: "+e+" ("+typeof e+")");if(!l(r))throw new RangeError("Input is not a safe number, it's either too large or too small.");return n=function e(t){var n,r,o=arguments[1];if(0===t)return o?o.join(" "):"zero";o||(o=[]);t<0&&(o.push("minus"),t=Math.abs(t));t<20?(n=0,r=m[t]):t<d?(n=t%u,r=w[Math.floor(t/u)],n&&(r+" "+m[n],n=0)):t<p?(n=t%d,r=e(Math.floor(t/d))+" hundred"):t<v?(n=t%p,r=e(Math.floor(t/p))+" thousand"):t<b?(n=t%v,r=e(Math.floor(t/v))+" million"):t<y?(n=t%b,r=e(Math.floor(t/y))+" billion"):t<c?(n=t%y,r=e(Math.floor(t/c))+" trillion"):t<=g&&(n=t%c,r=e(Math.floor(t/g))+" quadrillion");o.push(r);return e(n,o)}(r),t?h(n):n}
    return {
        toOrdinal:function(e){var t=parseInt(e,10);if(!f(t))throw new TypeError("Not a finite number");if(!l(t))throw new RangeError("Input is not a safe number");var n=String(t),r=Math.abs(t%100),o=11<=r&&r<=13,i=n.charAt(n.length-1);return n+(o?"th":"1"===i?"st":"2"===i?"nd":"3"===i?"rd":"th")},
        toWords:x,
        toWordsOrdinal:function(e){return h(x(e))}
    };
})();
// ----------------------------------------------------------------------------------

class IdiomChecker {
    constructor() {
        this.idiomSet = new Set();
        this.maxWords = 0; // Tracks the longest idiom to optimize the search window
        this.isReady = false;
        this.initPromise = null; // Lock to prevent multiple concurrent fetches
    }

    /**
     * Fully normalizes text using the custom ruleset.
     * Replaces contractions, converts numbers to words, and strips all punctuation.
     */
    _normalizeText(text) {
        if (!text) return "";

        // First convert specific contractions and words
        let normalizedText = text
            .replace(/\b(you[']?re|you are)\b/gi, 'your')
            .replace(/\b(they[']?re|their)\b/gi, 'there')
            .replace(/\bwe[']?re\b/gi, 'we are')
            .replace(/\bdoctor\b/gi, 'dr')
            .replace(/\bmister\b/gi, 'mr')
            .replace(/\bmissus\b/gi, 'mrs')
            .replace(/\brobin\b/gi, 'robbing')
            .replace(/\bkinda\b/gi, 'kind of')
            .replace(/\bgonna\b/gi, 'going to')
            .replace(/\bwanna\b/gi, 'want to')
            .replace(/\bgotta\b/gi, 'got to')
            .replace(/\bsorta\b/gi, 'sort of')
            .replace(/\boutta\b/gi, 'out of')
            .replace(/\bouta\b/gi, 'out of')
            .replace(/¢/gi, ' cents')        
            .replace(/\bum\b/gi, '')
            .replace(/\bumm\b/gi, '')
            .replace(/\bhmm\b/gi, '')
            .replace(/\bah\b/gi, '');

        // Then apply standard normalization: lowercase, remove ALL punctuation
        // Note: added standard directional curly quotes to the strip list just in case
        normalizedText = normalizedText
            .toLowerCase()                      
            .replace(/[.,!?;:()"'‘’”\--]/g, '') 
            .replace(/_/g, ' ')                 
            .replace(/\s+/g, ' ')               
            .trim();                            

        // Reduce successive repetitions of single words (like "i i", "you you")
        normalizedText = normalizedText.replace(/\b(\w+)\s+\1\b/gi, '$1');

        // Convert numbers to words (e.g., "6" -> "six")
        normalizedText = normalizedText.replace(/\b\d+\b/g, match => numberToWords.toWords(Number(match)));

        return normalizedText;
    }

    /**
     * Fetches the JSON and builds the instant-lookup Set.
     * Uses a promise lock so it's safe to call multiple times across different files.
     */
    async init() {
        if (this.isReady) return;
        
        // If an initialization is already in progress, wait for it to finish
        if (this.initPromise) return this.initPromise;

        console.log("IdiomChecker: Starting initialization...");

        // Create the promise and assign it to the lock
        this.initPromise = (async () => {
            try {
                const response = await fetch('js/data/idioms.json');
                const data = await response.json();
                
                let skippedWords = 0;

                const addPhrase = (phrase) => {
                    if (!phrase) return;
                    const cleaned = this._normalizeText(phrase);
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

                // Populate the Set with base phrases and specific patterns
                data.dictionary.forEach(entry => {
                    // Add the base phrase (handles cases with no parentheses)
                    addPhrase(entry.phrase);
                    
                    // Add the pre-compiled patterns (handles parentheses properly)
                    if (Array.isArray(entry.patterns)) {
                        entry.patterns.forEach(addPhrase);
                    }
                });

                this.isReady = true;
                
                console.log(`IdiomChecker: Successfully loaded ${this.idiomSet.size} valid multi-word idioms.`);
                if (skippedWords > 0) {
                    console.warn(`IdiomChecker: Skipped ${skippedWords} single-word entries from the JSON to prevent false positives.`);
                }
                console.log(`IdiomChecker: The longest idiom has ${this.maxWords} words. This sets the maximum search window.`);

            } catch (error) {
                console.error("Failed to load js/data/idioms.json:", error);
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

        console.log(`\n--- IdiomChecker: Analyzing new text ---`);
        console.log(`Original text: "${text}"`);

        // Clean and split the input text into an array of words
        const normalizedString = this._normalizeText(text);
        console.log(`Normalized string: "${normalizedString}"`);
        
        const words = normalizedString.split(' ').filter(w => w.length > 0);
        console.log(`Word array:`, words);
        
        let idiomCount = 0;
        let i = 0;
        const foundIdioms = []; // Track the actual matched strings for logging

        while (i < words.length) {
            let matched = false;
            
            // Check the longest possible combinations first (greedy match)
            const maxLen = Math.min(this.maxWords, words.length - i);
            console.log(`\n🔍 Checking at index ${i} (word: "${words[i]}")`);
            
            // Stop at len >= 2. An idiom must be at least 2 words.
            for (let len = maxLen; len >= 2; len--) {
                const candidate = words.slice(i, i + len).join(' ');
                console.log(`  Testing candidate (${len} words): "${candidate}"`);
                
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
                console.log(`  ❌ No matches starting with "${words[i]}". Moving to next word.`);
                i++;
            }
        }

        console.log(`\n🏁 Total idioms found in text: ${idiomCount}`);
        if (idiomCount > 0) {
            console.log(`📝 Idioms matched:`, foundIdioms);
        }
        console.log(`----------------------------------------`);
        
        return idiomCount;
    }
}

// Export a singleton instance so the Set only loads into memory once
export const idiomChecker = new IdiomChecker();
