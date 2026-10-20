// src/modules/courses/course-tag-labels.js
// Pure: the display label of a course topic.
//
// A topic is DATA — the `tags` array of a course config — so its translated
// name cannot live in the config. It lives in the strings table under
// `course_tag_<key>`, where `<key>` is the normalized topic with its spaces
// replaced by underscores (`getting to know you` -> `course_tag_getting_to_know_you`).
//
// A learner who is still learning English may not know what a topic means in
// English, so the ENGLISH word comes first and the learner's own language
// follows it ("Travel Viajes"). A topic with no entry in the strings table
// falls back to the config's own spelling, so a brand-new topic still renders.
//
// No DOM, no React, no data access.

import { strings } from '../../data/strings.js';
import { normalizeTag } from './course-tags-logic.js';

// The strings-table prefix every topic label lives under.
export const COURSE_TAG_STRING_PREFIX = 'course_tag_';

/**
 * The strings-table key of a topic.
 * @param {unknown} tag - the topic (any casing)
 * @returns {string} the key, or '' when there is no topic
 */
export function courseTagStringKey(tag) {
    const normalized = normalizeTag(tag);
    if (!normalized) return '';
    return `${COURSE_TAG_STRING_PREFIX}${normalized.replace(/\s+/g, '_')}`;
}

/**
 * The locale map of a topic, ready for `<BilingualText>`. Null when the topic
 * has no entry in the strings table (the caller then falls back to the raw
 * topic).
 * @param {unknown} tag - the topic (any casing)
 * @returns {object|null} the `{ en, es, pt, fr, hi, bn }` map, or null
 */
export function courseTagTranslation(tag) {
    const key = courseTagStringKey(tag);
    if (!key) return null;
    const entry = strings[key];
    if (!entry || typeof entry !== 'object') return null;
    return entry;
}

/**
 * The English word of a topic and the learner's-language word beside it.
 *
 * @param {unknown} tag - the topic (any casing)
 * @param {string} lang - the learner's language
 * @returns {{ english: string, localized: string }} `localized` is '' in English
 */
export function courseTagLabelParts(tag, lang = 'en') {
    const raw = typeof tag === 'string' ? tag.trim() : '';
    if (!raw) return { english: '', localized: '' };
    const entry = courseTagTranslation(raw);
    if (!entry) return { english: raw, localized: '' };
    const normalizedLang = (lang && typeof lang === 'string') ? lang.split('-')[0].toLowerCase() : 'en';
    const localized = normalizedLang !== 'en' && entry[normalizedLang] ? entry[normalizedLang] : '';
    return { english: entry.en || raw, localized };
}
