import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';

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

    configData.lessons.forEach(lesson => {
        lesson.title = getLocalizedTranslation(lesson.title, userLang);
        lesson.mission = getLocalizedTranslation(lesson.mission, userLang);
        lesson.setting = getLocalizedTranslation(lesson.setting, userLang);
        lesson.roleOther = getLocalizedTranslation(lesson.roleOther, userLang);
        lesson.roleUser = getLocalizedTranslation(lesson.roleUser, userLang);

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

                // Map 'inputType' to 'stepType'
                if (step.inputType !== undefined && step.stepType === undefined) {
                    step.stepType = step.inputType;
                }

                if (!step.step && (step.stepType === 'speech' || step.stepType === 'closedResponse' || step.stepType === 'openResponse')) {
                    step.step = Strings.get('default_q_speech', userLang);
                }

                if (step.step) step.step = getLocalizedTranslation(step.step, userLang);
                if (step.explanation) step.explanation = getLocalizedTranslation(step.explanation, userLang);
                if (step.translation) step.translation = getLocalizedTranslation(step.translation, userLang);
                if (step.subtitles) step.subtitles = getLocalizedTranslation(step.subtitles, userLang);

                // Ensure cue is always in English
                if (step.cue) step.cue = getLocalizedTranslation(step.cue, 'en');

                if (step.incues) {
                     step.incues = step.incues.map(incue => getLocalizedTranslation(incue, userLang));
                }
            });
        }
    });
}
