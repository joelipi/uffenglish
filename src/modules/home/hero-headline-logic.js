// src/modules/home/hero-headline-logic.js
//
// The public homepage hero headline is one sentence with three ROTATING slots:
// who the learner practises with (a relationship), the friend's CEFR band and
// the learner's own CEFR band. The sentence lives here — not in strings.js —
// because it is a template rather than a plain string: every locale supplies its
// own word order and its own possessive form for the relationship (`tu mamá`,
// `your mom`, the Bengali genitive `আপনার মায়ের`), while the CEFR tokens are
// shared across locales.
//
// Pure module: no React, no DOM, no store. The renderer (HeroHeadline.jsx) only
// maps the segments this module returns; every decision (which language, which
// word index, whether motion is welcome) is made here.

/** The CEFR bands the headline rotates through, weakest first. */
export const HERO_CEFR_LEVELS = Object.freeze(['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

// The learner's own band always sits this many places away from the friend's.
// It is coprime with the band count (7) and with the relationship count (6), so:
// the two bands are never equal, no (relationship, band, band) triple repeats
// until tick 42 (lcm(6, 7)), and every band appears in both slots exactly once
// per cycle.
export const HERO_LEVEL_OFFSET = 3;

/** One headline rotation step. */
export const HERO_ROTATION_INTERVAL_MS = 1000;

/** The media query that asks the browser to keep the headline still. */
export const HERO_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// The six relationships, per locale, with the possessive already attached so the
// surrounding sentence never has to inflect for gender (`tu mamá` / `tu amigo`,
// `sua mãe` / `seu amigo`). The order is fixed — it is part of the rotation.
//
// Every value is kept SHORT on purpose: the rotating cell is as wide as its
// LONGEST candidate, so a multi-word value ("tu compañero de clase") made the
// cell two thirds of a phone line and pushed the word onto a line of its own.
// The shortened forms are the natural everyday ones ("tu colega", "tu
// compañero"), and Portuguese uses "seu primo" for the sixth relationship
// because "seu colega de classe" would reintroduce that long cell.
export const HERO_RELATIONS = {
    en: ['your mom', 'your friend', 'your coworker', 'your neighbor', 'your ex', 'your classmate'],
    es: ['tu mamá', 'tu amigo', 'tu colega', 'tu vecino', 'tu ex', 'tu compañero'],
    pt: ['sua mãe', 'seu amigo', 'seu colega', 'seu vizinho', 'seu ex', 'seu primo'],
    fr: ['votre maman', 'votre ami', 'votre collègue', 'votre voisin', 'votre ex', 'votre camarade'],
    hi: ['अपनी माँ', 'अपने दोस्त', 'अपने सहकर्मी', 'अपने पड़ोसी', 'अपने एक्स', 'अपने सहपाठी'],
    bn: ['আপনার মায়ের', 'আপনার বন্ধুর', 'আপনার সহকর্মীর', 'আপনার প্রতিবেশীর', 'আপনার এক্সের', 'আপনার সহপাঠীর'],
};

// The sentence, per locale, with three placeholders:
//   {relation}    — a HERO_RELATIONS entry (possessive included)
//   {friendLevel} — the friend's CEFR band
//   {yourLevel}   — the learner's CEFR band
// The Spanish sentence is the original the feature was conceived in and is kept
// verbatim; the other locales say the same thing in their own word order.
export const HERO_HEADLINE_TEMPLATES = {
    en: "Practice English 🗣️ in 5 min with {relation}, even if they're {friendLevel} and you're {yourLevel} — without being online at the same time!",
    es: 'Practica inglés 🗣️ en 5 min con {relation}, aunque sea {friendLevel} y tú {yourLevel} — ¡sin estar conectados al mismo tiempo!',
    pt: 'Pratique inglês 🗣️ em 5 min com {relation}, mesmo que a outra pessoa seja {friendLevel} e você {yourLevel} — sem estarem online ao mesmo tempo!',
    fr: "Pratiquez l'anglais 🗣️ en 5 min avec {relation}, même si l'autre est {friendLevel} et vous {yourLevel} — sans être en ligne en même temps !",
    hi: '5 मिनट में अंग्रेज़ी 🗣️ बोलने का अभ्यास करें {relation} के साथ, भले ही वे {friendLevel} हों और आप {yourLevel} — एक ही समय पर ऑनलाइन हुए बिना!',
    bn: '৫ মিনিটে ইংরেজি 🗣️ বলার চর্চা করুন {relation} সাথে, যদিও তারা {friendLevel} আর আপনি {yourLevel} — একই সময়ে অনলাইন না থেকেই!',
};

// The locales the headline is written in. English is the default and the
// fallback: a learner whose profile language is not translated reads English,
// never a half-translated sentence.
export const HERO_HEADLINE_LANGS = Object.freeze(Object.keys(HERO_HEADLINE_TEMPLATES));

const SLOT_NAMES = Object.freeze(['relation', 'friendLevel', 'yourLevel']);
const SLOT_TOKEN = new RegExp(`\\{(${SLOT_NAMES.join('|')})\\}`, 'g');

/**
 * The headline locale for a language code: base tag, lowercased, English for
 * anything we do not translate (including the guest modal's 'OTHER' sentinel,
 * which must never become a locale or a `lang` attribute).
 *
 * @param {string|null|undefined} lang
 * @returns {string} one of HERO_HEADLINE_LANGS
 */
export function normalizeHeroLang(lang) {
    if (typeof lang !== 'string') return 'en';
    const base = lang.trim().split(/[-_]/)[0].toLowerCase();
    if (!base || base === 'other') return 'en';
    return HERO_HEADLINE_LANGS.includes(base) ? base : 'en';
}

/** The six relationships for a locale, in rotation order. */
export function heroRelations(lang) {
    return [...HERO_RELATIONS[normalizeHeroLang(lang)]];
}

/** The friend's rotating CEFR bands, in rotation order. */
export function heroFriendLevels() {
    return [...HERO_CEFR_LEVELS];
}

/**
 * The learner's rotating CEFR bands. Each one is HERO_LEVEL_OFFSET places away
 * from the friend's band at the same tick, so the sentence never claims both
 * people are at the same level.
 */
export function heroYourLevels() {
    return HERO_CEFR_LEVELS.map(
        (_, i) => HERO_CEFR_LEVELS[(i + HERO_LEVEL_OFFSET) % HERO_CEFR_LEVELS.length],
    );
}

/** The rotating values behind a slot name (empty for an unknown slot). */
export function heroSlotValues(slot, lang) {
    if (slot === 'relation') return heroRelations(lang);
    if (slot === 'friendLevel') return heroFriendLevels();
    if (slot === 'yourLevel') return heroYourLevels();
    return [];
}

/** The raw template for a locale, placeholders included. */
export function heroHeadlineTemplate(lang) {
    return HERO_HEADLINE_TEMPLATES[normalizeHeroLang(lang)];
}

/**
 * The headline split into rendered segments, in reading order:
 *   { kind: 'text', text }                      — static copy
 *   { kind: 'slot', slot, values }              — a rotating word
 *
 * `String.split` with a capturing pattern keeps the placeholders in the output,
 * so a placeholder can never be silently dropped by a template edit.
 *
 * @returns {Array<{kind: string, text?: string, slot?: string, values?: string[]}>}
 */
export function heroHeadlineSegments(lang) {
    return heroHeadlineTemplate(lang)
        .split(SLOT_TOKEN)
        .filter((part) => part !== '')
        .map((part) => (
            SLOT_NAMES.includes(part)
                ? { kind: 'slot', slot: part, values: heroSlotValues(part, lang) }
                : { kind: 'text', text: part }
        ));
}

/**
 * The index a slot shows at a tick. Wraps in both directions, so a negative or
 * non-finite tick can never index out of the list (a `NaN` would otherwise
 * render an empty word).
 */
export function heroSlotIndex(tick, length) {
    if (!Number.isFinite(length) || length <= 0) return 0;
    const step = Number.isFinite(tick) ? Math.trunc(tick) : 0;
    return ((step % length) + length) % length;
}

/**
 * The headline segments with the active index resolved for this tick. The
 * renderer stacks every value in the same grid cell and only the active one is
 * visible, so the line never reflows as words change.
 */
export function resolveHeroHeadline(lang, tick = 0) {
    return heroHeadlineSegments(lang).map((segment) => (
        segment.kind === 'slot'
            ? { ...segment, activeIndex: heroSlotIndex(tick, segment.values.length) }
            : segment
    ));
}

/**
 * The headline as plain text for a tick — the accessible sentence, the copy a
 * share preview needs, and the value tests assert against.
 */
export function heroHeadlineText(lang, tick = 0) {
    return resolveHeroHeadline(lang, tick)
        .map((segment) => (segment.kind === 'slot'
            ? segment.values[segment.activeIndex]
            : segment.text))
        .join('');
}

/**
 * Whether the headline may rotate. Reads the motion preference through an
 * injected `matchMedia` so the decision is testable and the component stays free
 * of it; a missing or throwing `matchMedia` (jsdom, an old browser) reads as
 * "motion is welcome", because the headline is still readable while still.
 *
 * @param {((query: string) => { matches: boolean })|null|undefined} matchMedia
 * @returns {boolean}
 */
export function readPrefersReducedMotion(matchMedia) {
    try {
        if (typeof matchMedia !== 'function') return false;
        return matchMedia(HERO_REDUCED_MOTION_QUERY)?.matches === true;
    } catch (err) {
        console.error('[HeroHeadline] Failed to read the motion preference:', err);
        return false;
    }
}
