// modules/lesson/success-step.web.js
// Web-only binding for the code-owned success step.
//
// The success captions live as separate .srt files in src/assets/subtitles/ and
// are linked here with Vite's `?raw` — inlined into the bundle at build time, so
// there is no runtime fetch and the final step keeps working offline (the SW
// precaches the JS chunk; `globPatterns` does not cover `.srt`). This is the ONLY
// module that imports them; the rules live in success-step-logic.js and stay
// platform-agnostic.

import friendEn from '../../assets/subtitles/friend-success.en.srt?raw';
import friendEs from '../../assets/subtitles/friend-success.es.srt?raw';
import friendPt from '../../assets/subtitles/friend-success.pt.srt?raw';
import friendBn from '../../assets/subtitles/friend-success.bn.srt?raw';
import friendFr from '../../assets/subtitles/friend-success.fr.srt?raw';
import singlePlayerEn from '../../assets/subtitles/single-player-success.en.srt?raw';
import singlePlayerEs from '../../assets/subtitles/single-player-success.es.srt?raw';
import singlePlayerPt from '../../assets/subtitles/single-player-success.pt.srt?raw';
import singlePlayerBn from '../../assets/subtitles/single-player-success.bn.srt?raw';
import singlePlayerFr from '../../assets/subtitles/single-player-success.fr.srt?raw';

import {
    SUCCESS_TYPE_FRIEND,
    SUCCESS_TYPE_SINGLE_PLAYER,
    applySuccessSteps as applySuccessStepsWith,
} from './success-step-logic.js';

/** Captions per success-step type, keyed by language.
 *
 * The two types intentionally share identical copy today (one canonical text),
 * kept as separate files so each video's captions can diverge independently.
 */
export const SUCCESS_SRT = {
    [SUCCESS_TYPE_FRIEND]: { en: friendEn, es: friendEs, pt: friendPt, bn: friendBn, fr: friendFr },
    [SUCCESS_TYPE_SINGLE_PLAYER]: { en: singlePlayerEn, es: singlePlayerEs, pt: singlePlayerPt, bn: singlePlayerBn, fr: singlePlayerFr },
};

/**
 * Apply the canonical success step to every lesson of a course config, choosing
 * the video slug and captions from the lesson type and the active language.
 *
 * @param {object} config a course config
 * @param {string} [lang] the resolved UI language
 * @returns {object} the config
 */
export function applySuccessSteps(config, lang = 'en') {
    return applySuccessStepsWith(config, { lang, srtByType: SUCCESS_SRT });
}
