import Strings from '../../data/strings.js';
import { getLocalizedTranslation } from '../utils/utils.js';
import { appStore } from '../store/store.js';

const FRIEND_CODE_REGEX = /\{friendCode\}-?/g;

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

function resolveFriendCode(value, friendCode) {
    if (typeof value !== 'string' || !value.includes('{friendCode}')) return value;
    const code = friendCode && friendCode.trim() ? friendCode.trim().toLowerCase() : '';
    return value.replace(FRIEND_CODE_REGEX, () => (code ? code + '-' : ''));
}

function applyFriendCodeWildcards(node, friendCode) {
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            node[i] = applyFriendCodeWildcards(node[i], friendCode);
        }
        return node;
    }
    if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
            node[key] = applyFriendCodeWildcards(node[key], friendCode);
        }
        return node;
    }
    return resolveFriendCode(node, friendCode);
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

    applyFriendCodeWildcards(configData, appStore.getState().friendCode);

    configData.lessons.forEach(lesson => {
        lesson.title = getLocalizedTranslation(lesson.title, userLang);
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
