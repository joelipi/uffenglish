//normalize.js
//This takes the text and normalizes it

/*!
 * Number-To-Words util
 * @version v1.2.4
 * @link https://github.com/marlun78/number-to-words
 * @author Martin Eneqvist (https://github.com/marlun78)
 * @contributors Aleksey Pilyugin (https://github.com/pilyugin),Jeremiah Hall (https://github.com/jeremiahrhall),Adriano Melo (https://github.com/adrianomelo),dmrzn (https://github.com/dmrzn)
 * @license MIT
 * @description IMPORTANT Updated by Joel to avoid adding punctuation (including hyphens and commas) to the result, which undoes normalization
 * @description Updated: fixed the billion/trillion/quadrillion magnitude divisors, which divided by the next scale up and produced "zero billion" for 1000000000
 */
!function(){"use strict";var e="object"==typeof self&&self.self===self&&self||"object"==typeof global&&global.global===global&&global||this,t=9007199254740991;function f(e){return!("number"!=typeof e||e!=e||e===1/0||e===-1/0)}function l(e){return"number"==typeof e&&Math.abs(e)<=t}var n=/(hundred|thousand|(m|b|tr|quadr)illion)$/,r=/teen$/,o=/y$/,i=/(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/,s={zero:"zeroth",one:"first",two:"second",three:"third",four:"fourth",five:"fifth",six:"sixth",seven:"seventh",eight:"eighth",nine:"ninth",ten:"tenth",eleven:"eleventh",twelve:"twelfth"};function h(e){return n.test(e)||r.test(e)?e+"th":o.test(e)?e.replace(o,"ieth"):i.test(e)?e.replace(i,a):e}function a(e,t){return s[t]}var u=10,d=100,p=1e3,v=1e6,b=1e9,y=1e12,c=1e15,g=9007199254740992,m=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"],w=["zero","ten","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];function x(e,t){var n,r=parseInt(e,10);if(!f(r))throw new TypeError("Not a finite number: "+e+" ("+typeof e+")");if(!l(r))throw new RangeError("Input is not a safe number, it's either too large or too small.");return n=function e(t){var n,r,o=arguments[1];if(0===t)return o?o.join(" "):"zero";o||(o=[]);t<0&&(o.push("minus"),t=Math.abs(t));t<20?(n=0,r=m[t]):t<d?(n=t%u,r=w[Math.floor(t/u)],n&&(r+" "+m[n],n=0)):t<p?(n=t%d,r=e(Math.floor(t/d))+" hundred"):t<v?(n=t%p,r=e(Math.floor(t/p))+" thousand"):t<b?(n=t%v,r=e(Math.floor(t/v))+" million"):t<y?(n=t%b,r=e(Math.floor(t/b))+" billion"):t<c?(n=t%y,r=e(Math.floor(t/y))+" trillion"):t<=g&&(n=t%c,r=e(Math.floor(t/c))+" quadrillion");o.push(r);return e(n,o)}(r),t?h(n):n}var M={toOrdinal:function(e){var t=parseInt(e,10);if(!f(t))throw new TypeError("Not a finite number: "+e+" ("+typeof e+")");if(!l(t))throw new RangeError("Input is not a safe number, it's either too large or too small.");var n=String(t),r=Math.abs(t%100),o=11<=r&&r<=13,i=n.charAt(n.length-1);return n+(o?"th":"1"===i?"st":"2"===i?"nd":"3"===i?"rd":"th")},toWords:x,toWordsOrdinal:function(e){return h(x(e))}};typeof global !== "undefined" ? global.numberToWords = M : e.numberToWords = M}();

// Currency symbols and words are unified to a single canonical token so a
// speech-to-text transcription of an amount as "$5" matches an authored cue
// of "five dollars". The canonical form is the plural word. Symbols are the
// single-character keys; words (singular + irregular plurals) collapse to the
// same canonical token.
const CURRENCY_CANONICAL = {
    // Symbols
    '$': 'dollars',
    '€': 'euros',
    '£': 'pounds',
    '¥': 'yen',
    '₹': 'rupees',
    '₨': 'rupees',
    '₩': 'won',
    '₽': 'rubles',
    '₺': 'lira',
    '₴': 'hryvnias',
    '₦': 'naira',
    '₱': 'pesos',
    '₫': 'dong',
    '฿': 'baht',
    '₪': 'shekels',
    '₡': 'colones',
    '₲': 'guaranis',
    '₵': 'cedis',
    '₸': 'tenge',
    '₼': 'manats',
    '₾': 'lari',
    '₭': 'kips',
    '₮': 'tugriks',
    '﷼': 'rials',
    // Word forms (singular + irregular plurals) collapse to the same token.
    dollar: 'dollars', dollars: 'dollars',
    euro: 'euros', euros: 'euros',
    pound: 'pounds', pounds: 'pounds',
    rupee: 'rupees', rupees: 'rupees',
    ruble: 'rubles', rubles: 'rubles',
    rouble: 'rubles', roubles: 'rubles',
    hryvnia: 'hryvnias', hryvnias: 'hryvnias',
    peso: 'pesos', pesos: 'pesos',
    shekel: 'shekels', shekels: 'shekels',
    yen: 'yen', yuan: 'yuan', renminbi: 'renminbi',
    won: 'won', lira: 'lira', naira: 'naira', dong: 'dong', baht: 'baht',
    franc: 'francs', francs: 'francs',
    reais: 'reais',
    rand: 'rand', ringgit: 'ringgit',
    colones: 'colones',
    guarani: 'guaranis', guaranis: 'guaranis',
    cedi: 'cedis', cedis: 'cedis',
    tenge: 'tenge',
    manat: 'manats', manats: 'manats',
    lari: 'lari',
    kip: 'kips', kips: 'kips',
    tugrik: 'tugriks', tugriks: 'tugriks',
    rial: 'rials', rials: 'rials',
    riyal: 'riyals', riyals: 'riyals',
    // Subunits (minor units)
    cent: 'cents', cents: 'cents',
    centavo: 'centavos', centavos: 'centavos',
    paisa: 'paise', paise: 'paise',
    kopeck: 'kopecks', kopecks: 'kopecks', kopek: 'kopecks', kopeks: 'kopecks',
    kopiyka: 'kopiykas', kopiykas: 'kopiykas',
    penny: 'pence', pennies: 'pence', pence: 'pence',
    kobo: 'kobo',
    agora: 'agorot', agorot: 'agorot',
    satang: 'satang',
};

// Each currency's minor unit, so "$5.50" → "five dollars fifty cents" but
// "£5.50" → "five pounds fifty pence". Defaults to "cents".
const CURRENCY_SUBUNIT = {
    pounds: 'pence',
    pesos: 'centavos',
    rupees: 'paise',
    rubles: 'kopecks',
    hryvnias: 'kopiykas',
    naira: 'kobo',
    shekels: 'agorot',
    baht: 'satang',
};

// "5.50" + "dollars" → "5 dollars 50 cents"; a zero whole part is dropped so
// "$0.50" → "50 cents". Digits survive to the number→words pass.
function formatMoney(whole, cents, currencyWord) {
    if (!cents) return `${whole} ${currencyWord}`;
    const subunit = CURRENCY_SUBUNIT[currencyWord] || 'cents';
    // ".5" of a unit is 50 cents, not 5.
    const centsDigits = cents.length === 1 ? `${cents}0` : cents;
    const wholeDigits = whole.replace(/,/g, '');
    if (/^0+$/.test(wholeDigits)) return `${centsDigits} ${subunit}`;
    return `${whole} ${currencyWord} ${centsDigits} ${subunit}`;
}

// Single-character keys are the currency symbols; longer keys are the spelled
// words. A future multi-character symbol (e.g. "R$") would need to be listed
// explicitly here rather than relying on the length test.
const CURRENCY_SYMBOL_CHARS = Object.keys(CURRENCY_CANONICAL)
    .filter((key) => key.length === 1)
    .join('');
const CURRENCY_WORDS_ALTERNATION = Object.keys(CURRENCY_CANONICAL)
    .filter((key) => key.length > 1)
    .join('|');
// Magnitude words that can follow a number ("1 million", "$2 thousand").
const MAGNITUDE_WORDS = ['hundred', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];
const MAGNITUDE_ALTERNATION = MAGNITUDE_WORDS.join('|');
// Whole and cents digits are captured separately so the decimal point is not
// later stripped as punctuation ($5.50 → "5 dollars 50 cents").
const CURRENCY_SYMBOL_NUMBER_RE = new RegExp(
    `([${CURRENCY_SYMBOL_CHARS}])\\s*(\\d[\\d,]*)(?:\\.(\\d+))?`,
    'g'
);
// "$1 million" / "$1.5 million" → "1 million dollars" / "1 point 5 million
// dollars". Runs before CURRENCY_SYMBOL_NUMBER_RE so the whole magnitude phrase
// is treated as one amount instead of "$1" + a dangling "million".
const CURRENCY_SYMBOL_MAGNITUDE_RE = new RegExp(
    `([${CURRENCY_SYMBOL_CHARS}])\\s*(\\d[\\d,]*)(?:\\.(\\d+))?\\s+(${MAGNITUDE_ALTERNATION})\\b`,
    'gi'
);
// Word-form decimal magnitude without a symbol: "1.5 million" → "1 point 5 million".
const MAGNITUDE_DECIMAL_RE = new RegExp(
    `\\b(\\d[\\d,]*)\\.(\\d+)\\s+(${MAGNITUDE_ALTERNATION})\\b`,
    'gi'
);
const CURRENCY_SYMBOL_RE = new RegExp(`[${CURRENCY_SYMBOL_CHARS}]`, 'g');
// Word-form decimals: "5.50 dollars" → "5 dollars 50".
const CURRENCY_WORD_DECIMAL_RE = new RegExp(
    `\\b(\\d[\\d,]*)\\.(\\d+)\\s+(${CURRENCY_WORDS_ALTERNATION})\\b`,
    'gi'
);
const CURRENCY_WORD_RE = new RegExp(`\\b(${CURRENCY_WORDS_ALTERNATION})\\b`, 'gi');

// "a" before a quantity/currency word is expanded to "one" so "a million"
// matches a transcribed "1,000,000" (both normalize to "one million"). The
// currency entries are derived from CURRENCY_CANONICAL so the lists can't drift.
const ARTICLE_QUANTITY_WORDS = [
    ...MAGNITUDE_WORDS,
    ...new Set(Object.values(CURRENCY_CANONICAL)),
];
const ARTICLE_QUANTITY_RE = new RegExp(`\\ba\\s+(?=(?:${ARTICLE_QUANTITY_WORDS.join('|')})\\b)`, 'gi');

// Convert text to normalized form
export async function normalize(text) {
    //console.log('new normalize called;')
    // First convert specific contractions and words
    let normalizedText = text
        // Currency: reorder "<symbol><amount>" to "<amount> <word>" so the
        // digit→words pass below turns "$5" into "five dollars", matching an
        // authored cue of "five dollars". Bare symbols and singular/plural
        // word forms collapse to the same canonical word.
        .replace(CURRENCY_SYMBOL_MAGNITUDE_RE, (match, symbol, whole, cents, magnitude) => {
            const numberPart = cents ? `${whole} point ${cents}` : whole;
            return `${numberPart} ${magnitude} ${CURRENCY_CANONICAL[symbol]}`;
        })
        .replace(CURRENCY_SYMBOL_NUMBER_RE, (match, symbol, whole, cents) =>
            formatMoney(whole, cents, CURRENCY_CANONICAL[symbol]))
        .replace(CURRENCY_SYMBOL_RE, (symbol) => ` ${CURRENCY_CANONICAL[symbol]} `)
        .replace(CURRENCY_WORD_DECIMAL_RE, (match, whole, cents, word) =>
            formatMoney(whole, cents, CURRENCY_CANONICAL[word.toLowerCase()]))
        .replace(MAGNITUDE_DECIMAL_RE, (match, whole, cents, magnitude) =>
            `${whole} point ${cents} ${magnitude}`)
        .replace(CURRENCY_WORD_RE, (word) => CURRENCY_CANONICAL[word.toLowerCase()])
        // "a million" / "a thousand" / "a dollar" → "one million" / ...
        .replace(ARTICLE_QUANTITY_RE, 'one ')
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

    // Then apply standard normalization: lowercase, remove punctuation, and excess spaces
    normalizedText = normalizedText
        .toLowerCase()                      // Convert to lowercase
        .replace(/[.,!?;:()"'’-]/g, '')       // Remove punctuation (including apostrophes)
        .replace(/_/g, ' ')                 // Replace underscore with a single space
        .replace(/\s+/g, ' ')               // Replace multiple spaces with a single space
        .trim();                            // Remove leading and trailing spaces

    // Reduce successive repetitions of single words (like "I I", "you you", "can can")
    normalizedText = normalizedText.replace(/\b(\w+)\s+\1\b/gi, '$1');

    // Convert numbers to words
    const wordsWithNumbersConverted = normalizedText.replace(/\b\d+\b/g, match => numberToWords.toWords(Number(match)));

    return wordsWithNumbersConverted;
}

// Exporting
export default normalize;
