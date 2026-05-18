import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';

/**
 * Mutates configData in place, normalizing all localized object fields to plain strings
 * and filling in default screen text where the screen field is missing.
 * Safe to call multiple times — skips fields that are already strings.
 *
 * @param {Object} configData - The raw config object loaded from the course JSON
 * @param {string} lang - The user's native language code (e.g. 'es')
 */
export function normalizeConfig(configData, lang = 'en') {
    if (!configData || !configData.lessons) return;

    const userLang = lang || 'en';

    const defaultScreens = {
        'closedResponse': Strings.get('default_q_closedResponse', userLang),
        'openResponse': Strings.get('default_q_openResponse', userLang),
        'present': Strings.get('default_q_present', userLang),
        'success': Strings.get('default_q_present', userLang),
        'lessonIntro': Strings.get('default_q_lesson_intro', userLang)
    };

    configData.lessons.forEach(lesson => {
        lesson.title = getLocalizedTranslation(lesson.title, userLang);
        lesson.mission = getLocalizedTranslation(lesson.mission, userLang);
        lesson.setting = getLocalizedTranslation(lesson.setting, userLang);
        lesson.roleOther = getLocalizedTranslation(lesson.roleOther, userLang);
        lesson.roleUser = getLocalizedTranslation(lesson.roleUser, userLang);

        if (lesson.screens) {
            lesson.screens.forEach(screen => {
                // cue is the speech recognition target, always use English
                screen.cue = getLocalizedTranslation(screen.cue, 'en');

                // subtitles and other UI fields use the user's language
                screen.subtitles = getLocalizedTranslation(screen.subtitles, userLang);
                screen.translation = getLocalizedTranslation(screen.translation, userLang);
                screen.explanation = getLocalizedTranslation(screen.explanation, userLang);
                screen.headsUp = getLocalizedTranslation(screen.headsUp, userLang);

                if (Array.isArray(screen.incues)) {
                    screen.incues = screen.incues.map(incue => getLocalizedTranslation(incue, userLang));
                }

                if (!screen.screen && defaultScreens[screen.screenType]) {
                    screen.screen = defaultScreens[screen.screenType];
                }
            });
        }
    });
}