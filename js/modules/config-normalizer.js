import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';

/**
 * Mutates configData in place, normalizing all localized object fields to plain strings
 * and filling in default question text where the question field is missing.
 * Safe to call multiple times — skips fields that are already strings.
 *
 * @param {Object} configData - The raw config object loaded from the course JSON
 * @param {string} lang - The user's native language code (e.g. 'es')
 */
export function normalizeConfig(configData, lang = 'en') {
    if (!configData || !configData.lessons) return;

    const userLang = lang || 'en';

    const defaultQuestions = {
        'speech':      Strings.get('default_q_speech', userLang),
        'ai':          Strings.get('default_q_ai', userLang),
        'present':     Strings.get('default_q_present', userLang),
        'success':     Strings.get('default_q_present', userLang),
        'lessonIntro': Strings.get('default_q_lesson_intro', userLang)
    };

    configData.lessons.forEach(lesson => {
        lesson.title = getLocalizedTranslation(lesson.title, userLang);
        lesson.mission = getLocalizedTranslation(lesson.mission, userLang);
        lesson.setting = getLocalizedTranslation(lesson.setting, userLang);
        lesson.roleA = getLocalizedTranslation(lesson.roleA, userLang);
        lesson.roleB = getLocalizedTranslation(lesson.roleB, userLang);

        if (lesson.questions) {
            lesson.questions.forEach(question => {
                // cue is the speech recognition target, always use English
                question.cue = getLocalizedTranslation(question.cue, 'en');
                
                // subtitles and other UI fields use the user's language
                question.subtitles = getLocalizedTranslation(question.subtitles, userLang);
                question.translation = getLocalizedTranslation(question.translation, userLang);
                question.explanation = getLocalizedTranslation(question.explanation, userLang);
                question.headsUp = getLocalizedTranslation(question.headsUp, userLang);

                if (Array.isArray(question.incues)) {
                    question.incues = question.incues.map(incue => getLocalizedTranslation(incue, userLang));
                }
                
                if (!question.question && defaultQuestions[question.inputType]) {
                    question.question = defaultQuestions[question.inputType];
                }
            });
        }
    });
}