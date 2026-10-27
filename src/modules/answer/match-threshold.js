// modules/answer/match-threshold.js
//
// The similarity a closed-response answer needs before it counts as a match.
//
// The score is a character-level Levenshtein ratio
// (calculate-similarity.js: (maxLen - distance) / maxLen), so a fixed
// percentage does NOT mean a fixed number of tolerated characters: 95% of a
// 20-character cue allows ONE character, while 95% of a 160-character cue
// allows eight. The learner is repeating a model sentence, and the short rungs
// of a lesson ("Speak every language.", "Thank you. Bye!") are where a single
// transcription slip or a dropped article used to fail the answer outright.
//
// So the threshold is a function of the cue's own length:
//
//   cue longer than 60 characters → 90%
//       a full sentence: one wrong word, a contraction ("I'd" vs "I would"),
//       or a dropped punctuation all still match.
//   cue 60 characters or shorter → 85%
//       a short phrase: a plural ending, a swapped function word, or a
//       one or two character transcription slip still match.
//
// Why 85 and not lower: the ratio is dominated by whatever the two strings
// share, so on a SHORT cue a wrong content word can still score high. Measured
// against this app's own cues, 80% accepted "My favorite color is yellow" for a
// template cue whose slots are blue/red/green (81.5%) and "A long beach vacation
// with bad weather." as the answer to "A short beach vacation with great
// weather." (80.5%) — the opposite branch of the same question. 85% rejects both
// and still gives a 20-character cue three characters of slack against the one
// character it had at 95%.
//
// The length is the NORMALIZED candidate the response is scored against
// (punctuation removed, digits spelled out, "a million" → "one million"), so
// the tier is decided on the same string the ratio uses.

export const SHORT_CUE_MAX_LENGTH = 60;
export const SHORT_CUE_THRESHOLD = 85;
export const LONG_CUE_THRESHOLD = 90;

/**
 * The similarity a response needs to match a cue of `normalizedCueLength`
 * characters.
 */
export function resolveMatchThreshold(normalizedCueLength) {
    const length = Number.isFinite(normalizedCueLength) ? normalizedCueLength : 0;
    return length > SHORT_CUE_MAX_LENGTH ? LONG_CUE_THRESHOLD : SHORT_CUE_THRESHOLD;
}

/** True when `similarity` clears the threshold for a cue of that length. */
export function isMatchAtThreshold(similarity, normalizedCueLength) {
    return similarity >= resolveMatchThreshold(normalizedCueLength);
}
