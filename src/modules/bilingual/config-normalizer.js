import Strings from '../../data/strings.js';
import { getLocalizedTranslation } from '../utils/utils.js';
import { appStore } from '../store/store.js';

const FRIEND_CODE_REGEX = /\{friendCode\}-?/g;
const SELF_CODE_REGEX = /\{selfCode\}-?/g;

/**
 * Replace a code placeholder with the lower-cased code (plus the separator the
 * template already implies). An unknown code drops the placeholder and its
 * hyphen so the slug does not keep a dangling separator.
 */
function substituteCode(value, regex, code) {
    const c = code && String(code).trim() ? String(code).trim().toLowerCase() : '';
    return value.replace(regex, () => (c ? `${c}-` : ''));
}

/**
 * Resolve the two share-code placeholders a UGC slug can carry:
 * `{friendCode}` (the recorder — the other party) and `{selfCode}` (the
 * recorder's own code, again).
 *
 * A chain clip is addressed by its RECORDER alone — `<recorder>-<recorder>-…` —
 * because the reader is the one who has to compute the key, and the reader
 * knows only two codes: the friend's and its own. The clip it wants is the
 * friend's own contribution to that namespace, and the friend published it
 * under their own name; a key built from the viewer's code
 * (`<friend>-<viewer>`) was never published, and neither was one built from the
 * friend's inviter, because the reader cannot know which link the friend was
 * answering.
 *
 * So the second slot resolves to the reference's RECORDER: the friend's code for
 * a friend reference, the viewer's own code for a self reference. That is the
 * same key the publisher writes (see `resolveInviterCode`,
 * `src/modules/video/video-processor-logic.js`), so every hop of the chain
 * resolves — the first (the asker's own clip) and every later one (the previous
 * learner's contribution to the same namespace).
 */
export function resolveShareCodes(value, { friendCode, selfCode } = {}) {
    if (typeof value !== 'string') return value;
    // The recorder is decided on the TEMPLATE (before the friend code is
    // substituted into it).
    const recorder = value.includes('{friendCode}') ? (friendCode || selfCode) : selfCode;
    let out = value;
    if (out.includes('{friendCode}')) out = substituteCode(out, FRIEND_CODE_REGEX, friendCode);
    if (out.includes('{selfCode}')) out = substituteCode(out, SELF_CODE_REGEX, recorder);
    return out;
}

function applyShareCodeWildcards(node, codes) {
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            node[i] = applyShareCodeWildcards(node[i], codes);
        }
        return node;
    }
    if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
            node[key] = applyShareCodeWildcards(node[key], codes);
        }
        return node;
    }
    return resolveShareCodes(node, codes);
}

/**
 * Resolves the language used to normalize a course config. Guest language wins
 * over the profile language, matching the rest of the app
 * (`guestNativeLanguage || userData.native_language || 'en'`). This matters for
 * friend lessons, where useGuestModalGuard adopts the browser language silently
 * and can write it after the config fetch has already resolved; without the
 * guest-first precedence the subtitles would be flattened to English.
 *
 * @param {string|null|undefined} guestLang - appStore.guestNativeLanguage
 * @param {string|null|undefined} profileLang - userData.native_language
 * @returns {string} a language code, defaulting to 'en'
 */
export function resolveConfigLanguage(guestLang, profileLang) {
    return guestLang || profileLang || 'en';
}

/**
 * The single source of truth for the app's active language outside React.
 *
 * `guestNativeLanguage` is authoritative and `userData.native_language` is its
 * mirror (AGENTS.md): the async profile bootstrap can write the fetched
 * profile's `native_language` ("EN") after a guest picked another language, so
 * reading `userData.native_language` directly renders English while the rest
 * of the app is localized. Call this (or `useNativeLanguage()` in components)
 * instead of reading `userData.native_language` — every ad-hoc expression is
 * a future localization regression.
 *
 * @param {object} [state] - defaults to the live store state (test seam)
 * @returns {string} a language code, defaulting to 'en'
 */
export function getAppLanguage(state) {
    const s = state || appStore.getState();
    return resolveConfigLanguage(s.guestNativeLanguage, s.userData?.native_language);
}

/**
 * Same guest-first rule for pure functions that carry `userData` as a
 * parameter (answer scoring, speech callbacks): the store's guest choice wins,
 * the parameter is the fallback, so existing callers and test doubles keep
 * working unchanged.
 *
 * @param {object} [userData] - e.g. the scoring pipeline's user record
 * @returns {string} a language code, defaulting to 'en'
 */
export function getAppLanguageFor(userData) {
    return getAppLanguage({
        guestNativeLanguage: appStore.getState().guestNativeLanguage,
        userData,
    });
}

/**
 * Whether the guest language is settled enough to normalize a course config.
 * The guest modal opens AFTER the config fetch resolves, so normalizing on
 * fetch would flatten subtitles to English before the guest picks a language.
 * Waiting for the language to settle means the config is normalized exactly
 * once, with the right language, and never re-normalized (which would restart
 * the lesson).
 *
 * Settled when:
 * - the user is logged in (their profile language is authoritative), or
 * - a guest language has been chosen (modal answered or silently adopted).
 *
 * @param {object} opts
 * @param {boolean} opts.isLoggedIn
 * @param {string|null|undefined} opts.guestLang - appStore.guestNativeLanguage
 * @returns {boolean}
 */
export function isConfigLanguageSettled({ isLoggedIn, guestLang } = {}) {
    return !!isLoggedIn || !!guestLang;
}

/**
 * Mutates configData in place, normalizing all localized object fields to plain strings
 * and filling in default step text where the step field is missing.
 * Safe to call multiple times — skips fields that are already strings.
 *
 * @param {Object} configData - The raw config object loaded from the course JSON
 * @param {string} lang - The user's native language code (e.g. 'es')
 */
export function normalizeConfig(configData, lang = 'en') {
    if (!configData || !configData.lessons) return;

    const userLang = lang || 'en';

    // A friend's clip is addressed by the friend's own code (the recorder), so
    // the viewer's own code is only needed for a self reference. For anonymous
    // viewers (no own share code) there is no second code at all: the friend's
    // code is the recorder of the clip they are about to watch.
    const selfCode = appStore.getState().userData?.shareCode || appStore.getState().friendCode;
    applyShareCodeWildcards(configData, {
        friendCode: appStore.getState().friendCode,
        selfCode,
    });

    configData.lessons.forEach(lesson => {
        // Lesson titles are curriculum labels, not learner-facing copy, so they
        // are normalized to English regardless of the user's language. A plain
        // string title round-trips unchanged; an object resolves to its `.en`.
        lesson.title = getLocalizedTranslation(lesson.title, 'en');
        // Keep mission/setting/roleUser/roleOther as multi-language objects for bilingual display
        // (same approach as cue below)

        // Map 'questions' to 'steps' if it comes from legacy JSON
        if (lesson.questions && !lesson.steps) {
            lesson.steps = lesson.questions;
        }

        if (lesson.steps) {
            lesson.steps.forEach(step => {
                // Map 'question' to 'step'
                if (step.question !== undefined && step.step === undefined) {
                    step.step = step.question;
                }

                // Map 'inputType' to 'responseType'
                if (step.inputType !== undefined && step.responseType === undefined) {
                    step.responseType = step.inputType;
                }

if (step.step) step.step = getLocalizedTranslation(step.step, userLang);
                if (step.explanation) step.explanation = getLocalizedTranslation(step.explanation, userLang);
                if (step.subtitles) step.subtitles = getLocalizedTranslation(step.subtitles, userLang);

                // Keep cue as multi-language object for bilingual display

                if (step.incues) {
                    step.incues = step.incues.map(incue => getLocalizedTranslation(incue, userLang));
                }
            });
        }
    });
}
