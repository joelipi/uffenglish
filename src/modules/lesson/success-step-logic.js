// modules/lesson/success-step-logic.js
// Pure rules for the end-of-lesson success step. The success step is CODE-OWNED:
// every lesson of the same type gets the SAME success video and captions, so it
// is no longer authored per course in the config. No React, no DOM, no React
// Native, no data access — the captions are injected as `srtByType` so this
// module stays platform-agnostic and fully unit-testable.
//
// Lesson type: a "friend" lesson is a share-CTA / friend-challenge chain lesson
// (`recapOverlay: 'shareCta'` — the shared predicate in friend-courses-logic.js);
// everything else is single-player. The success video is a function of that type,
// never of the course.

import { isFriendLesson } from '../courses/friend-courses-logic.js';

// The two canonical success videos (assets/videos/<slug>.mp4).
export const SUCCESS_VIDEO_FRIEND = 'friend-success';
export const SUCCESS_VIDEO_SINGLE_PLAYER = 'single-player-success';

// The two lesson types. These double as the keys of the injected `srtByType` map.
export const SUCCESS_TYPE_FRIEND = 'friend';
export const SUCCESS_TYPE_SINGLE_PLAYER = 'single-player';

export const SUCCESS_RESPONSE_TYPE = 'success';

/**
 * The success-step type of a lesson: 'friend' for a share-CTA / friend-challenge
 * lesson, 'single-player' otherwise.
 *
 * @param {object} lesson a course-config lesson
 * @returns {'friend'|'single-player'}
 */
export function successTypeFor(lesson) {
    return isFriendLesson(lesson) ? SUCCESS_TYPE_FRIEND : SUCCESS_TYPE_SINGLE_PLAYER;
}

/**
 * The canonical success video slug for a lesson type.
 *
 * @param {'friend'|'single-player'} type
 * @returns {string}
 */
export function successVideoSlugFor(type) {
    return type === SUCCESS_TYPE_FRIEND ? SUCCESS_VIDEO_FRIEND : SUCCESS_VIDEO_SINGLE_PLAYER;
}

/**
 * The localized captions for a lesson type, falling back to English (the app
 * never ships a type without English). Undefined when no captions are provided.
 *
 * @param {{type: string, lang?: string, srtByType?: object}} opts
 * @returns {string|undefined}
 */
export function successSubtitlesFor({ type, lang = 'en', srtByType = {} } = {}) {
    const byLang = srtByType[type] || {};
    return byLang[lang] || byLang.en || undefined;
}

/**
 * Build the canonical success step for a lesson: the type's video slug plus the
 * captions for `lang`. Pure — it neither reads nor mutates the lesson.
 *
 * @param {{lesson: object, lang?: string, srtByType?: object}} opts
 * @returns {object} an app-config step
 */
export function buildSuccessStep({ lesson, lang = 'en', srtByType = {} } = {}) {
    const type = successTypeFor(lesson);
    const step = {
        responseType: SUCCESS_RESPONSE_TYPE,
        simpleVideoUrl: successVideoSlugFor(type),
    };
    const subtitles = successSubtitlesFor({ type, lang, srtByType });
    if (subtitles !== undefined) step.subtitles = subtitles;
    return step;
}

/**
 * Make a lesson's success step canonical: replace an existing one (so no course
 * can drift from its type's video/captions) or append one when absent. Unknown
 * fields already on a config-provided success step are preserved, except
 * `subtitles`: when the canonical step has none, any inherited captions are
 * dropped so an old course's text can never pair with the new video slug.
 * Mutates and returns the lesson.
 *
 * @param {object} lesson
 * @param {{lang?: string, srtByType?: object}} opts
 * @returns {object} the lesson
 */
export function applySuccessStep(lesson, { lang = 'en', srtByType = {} } = {}) {
    if (!lesson || !Array.isArray(lesson.steps)) return lesson;
    const step = buildSuccessStep({ lesson, lang, srtByType });
    const index = lesson.steps.findIndex((s) => s && s.responseType === SUCCESS_RESPONSE_TYPE);
    if (index === -1) {
        lesson.steps.push(step);
    } else {
        const next = { ...lesson.steps[index], ...step };
        if (!('subtitles' in step)) delete next.subtitles;
        lesson.steps[index] = next;
    }
    return lesson;
}

/**
 * Apply the canonical success step to every lesson of a course config. Mutates
 * and returns the config.
 *
 * @param {object} config a course config (`{ lessons: [...] }`)
 * @param {{lang?: string, srtByType?: object}} opts
 * @returns {object} the config
 */
export function applySuccessSteps(config, { lang = 'en', srtByType = {} } = {}) {
    if (!config || !Array.isArray(config.lessons)) return config;
    for (const lesson of config.lessons) applySuccessStep(lesson, { lang, srtByType });
    return config;
}
