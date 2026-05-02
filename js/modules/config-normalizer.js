// --- modules/config-normalizer.js ---
import Strings from '../data/strings.js';

/**
 * Mutates configData in place, normalizing all localized object fields to plain strings
 * and filling in default question text where the question field is missing.
 * Safe to call multiple times — skips fields that are already strings.
 *
 * @param {Object} configData - The raw config object loaded from the course JSON
 * @param {string} lang - The user's native language code (e.g. 'es')
 */
export function normalizeConfig(configData, lang) {
    if (!configData || !configData.lessons) return;

    const defaultQuestions = {
        'speech':      Strings.get('default_q_speech', lang),
        'ai':          Strings.get('default_q_ai', lang),
        'present':     Strings.get('default_q_present', lang),
        'success':     Strings.get('default_q_present', lang),
        'lessonIntro': Strings.get('default_q_lesson_intro', lang)
    };

    configData.lessons.forEach(lesson => {
        if (lesson.title && typeof lesson.title === 'object') {
            lesson.title = lesson.title.en || String(lesson.title);
        }
        if (lesson.mission && typeof lesson.mission === 'object') {
            lesson.mission = lesson.mission.en || String(lesson.mission);
        }
        if (lesson.questions) {
            lesson.questions.forEach(question => {
                if (question.cue && typeof question.cue === 'object') {
                    question.cue = question.cue.en || String(question.cue);
                }
                if (!question.question && defaultQuestions[question.inputType]) {
                    question.question = defaultQuestions[question.inputType];
                }
            });
        }
    });
}