// scripts/lib/caption-utils.js
// Pure caption-generation utilities for the auto-caption pipeline
// (stories/009-auto-caption-simple-videos). All network/process work lives
// behind injected functions (transcribe/translate) so the whole pipeline is
// unit-testable with fakes. The CLI (scripts/generate-captions.mjs) supplies
// the real git/R2/ffmpeg/Whisper/DeepSeek implementations.

import { modify, applyEdits, parse } from 'jsonc-parser';

export const WHISPER_MODEL = 'onnx-community/whisper-base.en';
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
// Matches the six-language CTA_LOCALE_MAP convention in
// src/modules/video/video-processor-logic.js (EN, ES, PT, FR, HI, BN).
export const CAPTION_LANGUAGES = ['en', 'es', 'pt', 'fr', 'hi', 'bn'];

// A usable base SHA is a full 40-hex commit id that is not all zeros
// (all-zeros is the "new branch / force-push" sentinel from GitHub).
export function isUsableBaseSha(sha) {
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) && !/^0+$/.test(sha);
}

/**
 * Find every simpleVideoUrl occurrence in `afterConfig` whose slug was not
 * present anywhere in `beforeConfig`, skipping steps that already carry a
 * `subtitles` property. This is what enforces "new videos only" and "never
 * overwrite": existing uncaptioned slugs are in the before set, and authored
 * subtitles are skipped.
 *
 * Slugs containing the `{friendCode}` template placeholder are always
 * skipped: they are resolved per-user at runtime (config-normalizer.js) and
 * are not literal R2 filenames, so they can never be downloaded or captioned.
 *
 * @param {object|null} beforeConfig parsed before revision (null = new file)
 * @param {object} afterConfig parsed after revision
 * @returns {Array<{slug: string, lessonIndex: number, stepKey: 'steps'|'questions', stepIndex: number}>}
 */
export function findNewSimpleVideoTargets(beforeConfig, afterConfig) {
    const beforeSlugs = new Set();
    if (beforeConfig && Array.isArray(beforeConfig.lessons)) {
        for (const lesson of beforeConfig.lessons) {
            for (const step of lesson.steps || []) {
                if (step.simpleVideoUrl) beforeSlugs.add(step.simpleVideoUrl);
            }
            for (const question of lesson.questions || []) {
                if (question.simpleVideoUrl) beforeSlugs.add(question.simpleVideoUrl);
            }
        }
    }

    const targets = [];
    if (afterConfig && Array.isArray(afterConfig.lessons)) {
        afterConfig.lessons.forEach((lesson, lessonIndex) => {
            for (const stepKey of ['steps', 'questions']) {
                const list = lesson[stepKey] || [];
                list.forEach((step, stepIndex) => {
                    if (!step.simpleVideoUrl) return;
                    if (step.simpleVideoUrl.includes('{friendCode}')) return;
                    if (beforeSlugs.has(step.simpleVideoUrl)) return;
                    if (step.subtitles !== undefined) return;
                    targets.push({ slug: step.simpleVideoUrl, lessonIndex, stepKey, stepIndex });
                });
            }
        });
    }
    return targets;
}

// Format a seconds value as an SRT timestamp HH:MM:SS,mmm.
export function secondsToSrtTimestamp(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Build an SRT document from Whisper chunks. Cues are 1-based; each chunk's
 * text is trimmed; chunks with empty text or a non-finite start are skipped;
 * a null/undefined end falls back to the start (Whisper reports null ends).
 *
 * @param {Array<{timestamp: [number, number|null], text: string}>} chunks
 * @returns {string}
 */
export function chunksToSrt(chunks) {
    const cues = [];
    for (const chunk of chunks) {
        const text = (chunk.text || '').trim();
        if (!text) continue;
        const [start, end] = chunk.timestamp || [];
        if (!Number.isFinite(start)) continue;
        const endTime = end ?? start;
        cues.push(
            `${cues.length + 1}\n${secondsToSrtTimestamp(start)} --> ${secondsToSrtTimestamp(endTime)}\n${text}`,
        );
    }
    return cues.join('\n\n');
}

function srtTimeToSeconds(timeStr) {
    const [h, m, rest] = timeStr.split(':');
    const [s, ms] = rest.split(/[,.]/);
    return (
        parseInt(h, 10) * 3600 +
        parseInt(m, 10) * 60 +
        parseInt(s, 10) +
        parseInt(ms || '0', 10) / 1000
    );
}

// Parse an SRT document back into { start, end, text } cues.
export function parseSrt(srt) {
    const cues = [];
    const blocks = String(srt || '').trim().split(/\r?\n\s*\r?\n/);
    for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
        if (timeLineIndex === -1) continue;
        const [startStr, endStr] = lines[timeLineIndex].split('-->').map((s) => s.trim());
        const text = lines.slice(timeLineIndex + 1).join('\n').trim();
        cues.push({ start: srtTimeToSeconds(startStr), end: srtTimeToSeconds(endStr), text });
    }
    return cues;
}

/**
 * Validate that a translated SRT preserves the English SRT's cue count and
 * start/end timestamps (within 1 ms). Any mismatch means the translation
 * mangled the timing and must fail the job before anything is written.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateTranslatedSrt(englishSrt, translatedSrt) {
    const en = parseSrt(englishSrt);
    const tr = parseSrt(translatedSrt);
    if (en.length !== tr.length) {
        return { ok: false, reason: `cue count mismatch: expected ${en.length}, got ${tr.length}` };
    }
    for (let i = 0; i < en.length; i++) {
        if (Math.abs(en[i].start - tr[i].start) > 0.001) {
            return {
                ok: false,
                reason: `cue ${i + 1} start mismatch: expected ${en[i].start}, got ${tr[i].start}`,
            };
        }
        if (Math.abs(en[i].end - tr[i].end) > 0.001) {
            return {
                ok: false,
                reason: `cue ${i + 1} end mismatch: expected ${en[i].end}, got ${tr[i].end}`,
            };
        }
    }
    return { ok: true };
}

/**
 * Format-preserving injection of caption objects into a config file using
 * jsonc-parser. Steps that already carry a `subtitles` property are left
 * untouched (never overwrite). Throws if a target slug has no captions.
 *
 * @param {string} text config file text
 * @param {Array<{slug: string, lessonIndex: number, stepKey: string, stepIndex: number}>} targets
 * @param {Record<string, object>} captionsBySlug slug -> { en, es, pt, fr, hi, bn }
 * @returns {string} edited text
 */
export function applyCaptionsToText(text, targets, captionsBySlug) {
    const parsed = parse(text);
    let result = text;
    for (const target of targets) {
        const step = parsed?.lessons?.[target.lessonIndex]?.[target.stepKey]?.[target.stepIndex];
        if (step && step.subtitles !== undefined) continue;
        const captions = captionsBySlug[target.slug];
        if (!captions) {
            throw new Error(`No captions generated for slug "${target.slug}"`);
        }
        const path = ['lessons', target.lessonIndex, target.stepKey, target.stepIndex, 'subtitles'];
        result = applyEdits(
            result,
            modify(result, path, captions, {
                formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
            }),
        );
    }
    return result;
}

/**
 * Orchestration seam: steps 2/4/5/6 of the pipeline using injected
 * `transcribe(slug) -> chunks` and `translate(englishSrt, lang) -> srt`.
 *
 * @param {object} opts
 * @param {string|null} opts.beforeText before-revision file text (null = new file)
 * @param {string} opts.afterText after-revision file text
 * @param {(slug: string) => Promise<Array>} opts.transcribe
 * @param {(englishSrt: string, lang: string) => Promise<string>} opts.translate
 * @param {string[]} [opts.languages]
 * @returns {Promise<{text: string, generated: string[]}>}
 */
export async function buildCaptionEdits({ beforeText, afterText, transcribe, translate, languages = CAPTION_LANGUAGES }) {
    const beforeConfig = beforeText ? parse(beforeText) : null;
    const afterConfig = parse(afterText);
    const targets = findNewSimpleVideoTargets(beforeConfig, afterConfig);

    const captionsBySlug = {};
    const generated = [];
    const uniqueSlugs = [...new Set(targets.map((t) => t.slug))];
    for (const slug of uniqueSlugs) {
        const chunks = await transcribe(slug);
        const enSrt = chunksToSrt(chunks);
        const captions = { en: enSrt };
        for (const lang of languages) {
            if (lang === 'en') continue;
            const translated = await translate(enSrt, lang);
            const validation = validateTranslatedSrt(enSrt, translated);
            if (!validation.ok) {
                throw new Error(`Translation validation failed for ${slug} (${lang}): ${validation.reason}`);
            }
            captions[lang] = translated;
        }
        captionsBySlug[slug] = captions;
        generated.push(slug);
    }

    const text = applyCaptionsToText(afterText, targets, captionsBySlug);
    return { text, generated };
}