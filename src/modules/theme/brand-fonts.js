/**
 * Brand typography — single source of truth for the UFF English font kit.
 *
 * The three places that have to agree (the <link> in index.html, the custom
 * properties in app.css and the inline preloader style in index.html) all read
 * their values from here, and `brand-fonts-wiring.test.js` asserts they do.
 * Changing a family or a weight in this file and re-running that test tells you
 * exactly which surfaces still need updating.
 *
 * Pure module: no DOM, no React, no fetch. The <link> tags are described as
 * data (`HEAD_LINK_TAGS`) so they can be asserted without a build.
 */

/** Body / UI face: paragraphs, buttons, form controls. */
export const BODY_FONT_FAMILY = 'Inter';
export const BODY_FONT_WEIGHTS = [400, 500, 600];

/**
 * Display face for h1/h2/h3. Swapping the brand kit to one of
 * HEADING_ALTERNATES is a one-line change here plus the weight set below —
 * nothing else in the codebase names this family.
 */
export const HEADING_FONT_FAMILY = 'Titillium Web';
export const HEADING_FONT_WEIGHTS = [700, 900];

/** Approved replacements for HEADING_FONT_FAMILY. */
export const HEADING_ALTERNATES = ['Tomorrow', 'Chakra Petch', 'Saira'];

/**
 * Per-heading-level weights. h1 takes the heaviest face, h2/h3 the regular one.
 * Keeping this keyed by level (rather than a blanket `font-weight: 700`) is what
 * makes both requested weights actually load.
 */
export const HEADING_FONT_WEIGHT_BY_LEVEL = { 1: 900, 2: 700, 3: 700 };

/**
 * Which of HEADING_FONT_WEIGHTS have a TRUE italic face on Google Fonts.
 *
 * Titillium Web ships italic at 200/300/400/600/700 only — there is no italic
 * 900, and `family=Titillium+Web:ital,wght@1,900` is a hard HTTP 400. So h2/h3
 * (700) render with a real italic face and h1 (900) is slanted by the browser
 * instead. Requesting the non-existent face anyway would only work by accident
 * (Google drops it when other valid axes share the request) and would 400 the
 * moment the list shrank to it, so the URL below is built from real faces only.
 */
export const HEADING_ITALIC_WEIGHTS = HEADING_FONT_WEIGHTS.filter((w) => w === 700);

/** CSS levels the display face is applied to. */
export const HEADING_LEVELS = [1, 2, 3];

/**
 * The universal "future-proof" tail appended to every font stack, in the order
 * the browser must try it:
 *
 *   1. `system-ui` — the OS's own modern UI face; the default everywhere.
 *   2. the OS-native spellings Safari/macOS and Blink use internally
 *      (`-apple-system`, `BlinkMacSystemFont`) — they win over `system-ui` on
 *      the engines that still prefer them.
 *   3. the classic desktop faces, for engines with no `system-ui` support.
 *   4. Google's Noto Sans, whose coverage of every Unicode block is the reason
 *      an obscure character renders instead of a tofu box.
 *   5. `sans-serif`, the guaranteed-last resort generic.
 *
 * Quoting: a family whose name is not a single bare identifier (letters and
 * hyphens only — `Titillium Web` has a space) is wrapped in quotes, while
 * generic keywords and CSS-wide keywords are left bare. Bare matters here:
 * `system-ui` only behaves as the system keyword when it is unquoted.
 */
export const UNIVERSAL_FALLBACK_FONTS = [
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Noto Sans',
    'sans-serif',
];

const NEEDS_QUOTES = /[^A-Za-z-]/;

/** CSS keywords that must stay unquoted to keep their special meaning. */
const BARE_FAMILIES = new Set(['sans-serif', 'serif', 'monospace']);

/** `Noto Sans` → `'Noto Sans'`; `Inter` → `Inter`; `sans-serif` → `sans-serif`. */
export function quoteFamily(family) {
    if (BARE_FAMILIES.has(family)) return family;
    return NEEDS_QUOTES.test(family) ? `'${family}'` : family;
}

/** The full stack for one family: the family, then the universal tail. */
export function fontStack(family) {
    return [quoteFamily(family), ...UNIVERSAL_FALLBACK_FONTS.map(quoteFamily)].join(', ');
}

/**
 * Stylistic heading overrides for non-Latin alphabets, keyed by the language
 * subtag the app marks on a localized string (`<span lang="hi">`). Each entry
 * replaces only the *display* face — the shared universal tail is still there,
 * so a character the override lacks falls through to Noto Sans rather than a
 * tofu box.
 *
 * Weights are intentionally a single face (700): these are large, script-
 * specific families and a heading-level weight is all the kit asks for.
 */
export const LANG_HEADING_FONTS = {
    // Geometric, modern grotesque.
    ja: 'Zen Kaku Gothic New',
    // Simplified first; the traditional sub-tags below override it.
    zh: 'Noto Sans SC',
    // Traditional Chinese. `:lang(zh)` also matches these, so they are listed
    // separately in CSS and must stay after the `zh` rule.
    'zh-Hant': 'Noto Sans TC',
    'zh-HK': 'Noto Sans TC',
    'zh-TW': 'Noto Sans TC',
    // Squared-off, cybernetic geometry.
    hi: 'Khand',
    // Structured and tech-forward.
    bn: 'Hind Siliguri',
};

/** Languages that resolve to the same family, for the CSS selector list. */
export const LANG_HEADING_FAMILIES = [
    ...new Set(Object.values(LANG_HEADING_FONTS)),
];

/** The heading stack for one language subtag, or the default when unknown. */
export function langHeadingFontStack(lang) {
    return fontStack(LANG_HEADING_FONTS[lang] ?? HEADING_FONT_FAMILY);
}

/** The CSS custom properties app.css must declare. */
export const CSS_VARIABLES = {
    body: '--font-body',
    heading: '--font-heading',
};

/**
 * The CSS custom property that carries a language's heading face.
 *
 * Named after the FACE, not the subtag, so the variable set is exactly
 * `LANG_HEADING_FAMILIES` — zh-Hant/zh-HK/zh-TW share one variable because they
 * share one family, and nothing has to be kept in sync by hand.
 */
export function langHeadingVariable(lang) {
    const family = LANG_HEADING_FONTS[lang] ?? HEADING_FONT_FAMILY;
    return `--font-heading-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** Families the Google Fonts request must carry: body, headings, overrides. */
export function requestedFamilies() {
    return [BODY_FONT_FAMILY, HEADING_FONT_FAMILY, ...LANG_HEADING_FAMILIES];
}

/** Google Fonts' css2 query for one family, e.g. `Titillium+Web:ital,wght@0,700;1,700`. */
function familyQuery(family, { weights, italicWeights = [] }) {
    const name = family.replace(/ /g, '+');
    if (italicWeights.length === 0) return `${name}:wght@${weights.join(';')}`;
    // css2 requires the axis list to be alphabetical, so `ital` precedes `wght`,
    // and every axis value must be repeated per style.
    const tuples = [
        ...weights.map((w) => `0,${w}`),
        ...italicWeights.map((w) => `1,${w}`),
    ];
    return `${name}:ital,wght@${tuples.join(';')}`;
}

/** Weight requested for the :lang() override families (headings only). */
export const LANG_FONT_WEIGHT = 700;

/**
 * Every family/weight/style the Google Fonts request carries, in one list.
 * This is the only place a weight is turned into a URL fragment.
 */
export function requestedFontSpecs() {
    return [
        { family: BODY_FONT_FAMILY, weights: BODY_FONT_WEIGHTS, italicWeights: [] },
        {
            family: HEADING_FONT_FAMILY,
            weights: HEADING_FONT_WEIGHTS,
            italicWeights: HEADING_ITALIC_WEIGHTS,
        },
        ...LANG_HEADING_FAMILIES.map((family) => ({
            family,
            weights: [LANG_FONT_WEIGHT],
            italicWeights: [],
        })),
    ];
}

/**
 * The single css2 URL every <link> points at. `display=swap` keeps text
 * visible in the fallback stack while the webfont downloads, and only the
 * weights the brand kit actually uses are requested.
 *
 * Families are sorted so the URL is stable and cache-friendly regardless of
 * the order they were declared above.
 */
export function googleFontsUrl() {
    const queries = requestedFontSpecs()
        .sort((a, b) => a.family.localeCompare(b.family))
        .map(({ family, weights, italicWeights }) =>
            familyQuery(family, { weights, italicWeights }));

    return `https://fonts.googleapis.com/css2?${queries.map((q) => `family=${q}`).join('&')}&display=swap`;
}

/** Origin serving the css2 stylesheet (preconnected without crossorigin). */
export const STYLESHEET_ORIGIN = 'https://fonts.googleapis.com';

/** Origin serving the .woff2 files (preconnected WITH crossorigin — they are CORS fetches). */
export const FONT_FILE_ORIGIN = 'https://fonts.gstatic.com';

/**
 * The exact <head> tags, in the order they must appear. `preconnect` starts
 * the TCP/TLS handshake to both font origins while the parser is still walking
 * the head, so the stylesheet costs no extra round-trip.
 */
export function headLinkTags() {
    return [
        `<link rel="preconnect" href="${STYLESHEET_ORIGIN}">`,
        `<link rel="preconnect" href="${FONT_FILE_ORIGIN}" crossorigin>`,
        `<link rel="stylesheet" href="${googleFontsUrl()}">`,
    ];
}
