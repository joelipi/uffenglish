// idiom-normalizer.js
// Shared text normalization used by both the main-thread IdiomChecker and the
// idiom Web Worker. Keeping this in one file guarantees the two paths produce
// identical phrase sets.

// --- Number-To-Words Utility (Scoped locally to avoid polluting global namespace) ---
const numberToWords = (function () {
    "use strict";
    var t = 9007199254740991;
    function f(e) { return !("number" != typeof e || e != e || e === 1 / 0 || e === -1 / 0); }
    function l(e) { return "number" == typeof e && Math.abs(e) <= t; }
    var n = /(hundred|thousand|(m|b|tr|quadr)illion)$/, r = /teen$/, o = /y$/, i = /(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/, s = { zero: "zeroth", one: "first", two: "second", three: "third", four: "fourth", five: "fifth", six: "sixth", seven: "seventh", eight: "eighth", nine: "ninth", ten: "tenth", eleven: "eleventh", twelve: "twelfth" };
    function h(e) { return n.test(e) || r.test(e) ? e + "th" : o.test(e) ? e.replace(o, "ieth") : i.test(e) ? e.replace(i, a) : e; }
    function a(e, t) { return s[t]; }
    var u = 10, d = 100, p = 1e3, v = 1e6, b = 1e9, y = 1e12, c = 1e15, g = 9007199254740992, m = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"], w = ["zero", "ten", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    function x(e, t) { var n, r = parseInt(e, 10); if (!f(r)) throw new TypeError("Not a finite number: " + e + " (" + typeof e + ")"); if (!l(r)) throw new RangeError("Input is not a safe number, it's either too large or too small."); return n = function e(t) { var n, r, o = arguments[1]; if (0 === t) return o ? o.join(" ") : "zero"; o || (o = []); t < 0 && (o.push("minus"), t = Math.abs(t)); t < 20 ? (n = 0, r = m[t]) : t < d ? (n = t % u, r = w[Math.floor(t / u)], n && (r += " " + m[n], n = 0)) : t < p ? (n = t % d, r = e(Math.floor(t / d)) + " hundred") : t < v ? (n = t % p, r = e(Math.floor(t / p)) + " thousand") : t < b ? (n = t % v, r = e(Math.floor(t / v)) + " million") : t < y ? (n = t % b, r = e(Math.floor(t / b)) + " billion") : t < c ? (n = t % y, r = e(Math.floor(t / y)) + " trillion") : t <= g && (n = t % c, r = e(Math.floor(t / c)) + " quadrillion"); o.push(r); return e(n, o); }(r), t ? h(n) : n; }
    return {
        toOrdinal: function (e) { var t = parseInt(e, 10); if (!f(t)) throw new TypeError("Not a finite number"); if (!l(t)) throw new RangeError("Input is not a safe number"); var n = String(t), r = Math.abs(t % 100), o = 11 <= r && r <= 13, i = n.charAt(n.length - 1); return n + (o ? "th" : "1" === i ? "st" : "2" === i ? "nd" : "3" === i ? "rd" : "th"); },
        toWords: x,
        toWordsOrdinal: function (e) { return h(x(e)); }
    };
})();
// ----------------------------------------------------------------------------------

/**
 * Fully normalizes text using the custom ruleset.
 * Replaces contractions, converts numbers to words, and strips all punctuation.
 */
export function normalizeText(text) {
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
