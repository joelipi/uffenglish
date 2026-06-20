// modules/answers.js
import normalize from '../bilingual/normalize.js';
import calculateSimilarity from './calculate-similarity.js';
import swearjar from '../utils/swearjar.js';
import { evaluateWithAI } from '../api/api.js';
import Strings from '../../data/strings.js';
import { appStore } from '../store/store.js';

/**
 * Returns the position of stepData within the current lesson's steps array.
 *
 * Primary path: trusts the store-tracked currentStepIndex when it matches.
 * Fallback: content-based findIndex when there's a mismatch.
 */
export function getCurrentStepIndex(stepData, configData, currentLessonIndex) {
    if (!configData?.lessons?.length) return -1;
    if (currentLessonIndex < 0 || currentLessonIndex >= configData.lessons.length) return -1;

    const currentLesson = configData.lessons[currentLessonIndex];

    // ── Primary: store-tracked index ──
    const storeIndex = appStore.getState().currentStepIndex;
    if (storeIndex >= 0 && storeIndex < currentLesson.steps.length) {
        const storedStep = currentLesson.steps[storeIndex];
        const normCue1 = typeof stepData.cue === 'object' ? stepData.cue?.en : stepData.cue;
        const normCue2 = typeof storedStep.cue === 'object' ? storedStep.cue?.en : storedStep.cue;
        if (storedStep.step === stepData.step && normCue1 === normCue2) {
            return storeIndex;
        }
    }

    // ── Fallback: content-based findIndex ──
    console.warn('[getCurrentStepIndex] Store index mismatch, falling back to content lookup. storeIndex:', storeIndex, 'stepData.step:', stepData.step, 'cue:', typeof stepData.cue === 'object' ? stepData.cue?.en : stepData.cue);

    const normalizedCue1 = typeof stepData.cue === 'object' ? stepData.cue?.en : stepData.cue;
    return currentLesson.steps.findIndex(q => {
        const normalizedCue2 = typeof q.cue === 'object' ? q.cue?.en : q.cue;
        const sameStep = q.step === stepData.step &&
            q.explanation === stepData.explanation &&
            normalizedCue2 === normalizedCue1;

        const qIncues = Array.isArray(q.incues) ? [...q.incues].sort() : [];
        const dataIncues = Array.isArray(stepData.incues) ? [...stepData.incues].sort() : [];
        const sameIncues = qIncues.length === dataIncues.length &&
            qIncues.every((val, index) => val === dataIncues[index]);

        return sameStep && sameIncues;
    });
}

export async function processAnswerLogic({
    userResponse, cue, stepData, lesson, courseLevel, userData, apiRoot
}) {
    if (stepData.responseType === "openResponse") {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cueText.trim().toLowerCase());

        let result = {
            isCorrect: false,
            explanation: "",
            userResponse: userResponse,
            normalizeduserResponse: normalizeduserResponse,
            normalizedcue: normalizedcue,
            courseLevel: courseLevel || 'A0',
            cefrLevelDeduction: 0,
            errorType: ""
        };

        let evaluation;
        try {
            evaluation = await evaluateWithAI(userResponse, stepData, lesson, courseLevel);
        } catch (apiError) {
            console.error('[processAnswerLogic] AI API error, returning api_error result:', apiError);
            result.errorType = 'api_error';
            return result;
        }

        let labels = evaluation.labels;

        // Discard no-op grammar corrections that normalize to the same as user response
        if (labels.includes('grammar') && evaluation.grammarCorrectedText) {
            const normalizedGrammar = await normalize(evaluation.grammarCorrectedText.trim().toLowerCase());
            if (normalizedGrammar === normalizeduserResponse) {
                labels = labels.filter(l => l !== 'grammar');
                evaluation.grammarCorrectedText = null;
            }
        }

        // Discard no-op vocab corrections that normalize to the same as user response
        if (labels.includes('vocab') && evaluation.finalCorrectedText) {
            const normalizedVocab = await normalize(evaluation.finalCorrectedText.trim().toLowerCase());
            if (normalizedVocab === normalizeduserResponse) {
                labels = labels.filter(l => l !== 'vocab');
            }
        }

        // Discard vocab when its correction is identical to grammar's correction
        // (same error shouldn't deduct points twice)
        if (labels.includes('grammar') && labels.includes('vocab') &&
            evaluation.grammarCorrectedText && evaluation.finalCorrectedText) {
            const normalizedGrammarCorrection = await normalize(evaluation.grammarCorrectedText.trim().toLowerCase());
            const normalizedVocabCorrection = await normalize(evaluation.finalCorrectedText.trim().toLowerCase());
            if (normalizedGrammarCorrection === normalizedVocabCorrection) {
                labels = labels.filter(l => l !== 'vocab');
            }
        }

        if (labels.length > 1 && labels.includes("correct")) {
            labels = labels.filter(label => label !== "correct");
        }

        const isGrammarCorrect = !labels.includes('grammar');
        const isVocabCorrect = !labels.includes('vocab');
        const isIntelligible = !labels.includes('gibberish');
        const isIntentCorrect = labels.length === 0 || (labels.length === 1 && labels.includes('correct'));

        result.intentLabels = labels;
        result.isCorrect = isGrammarCorrect && isVocabCorrect && isIntelligible && isIntentCorrect;
        result.correction = evaluation.finalCorrectedText || evaluation.grammarCorrectedText || userResponse;

        if (result.isCorrect) {
            result.courseLevel = courseLevel || 'A0';
            result.cefrLevelDeduction = 0;
            result.errorType = 'correct';
        } else {
            let feedbackChunks = [];
            result.errorType = null;

            if (labels.includes('grammar')) {
                result.errorType = 'ungrammatical';
                feedbackChunks.push({
                    type: 'grammar_diff',
                    original: userResponse,
                    corrected: evaluation.grammarCorrectedText || evaluation.finalCorrectedText || userResponse,
                    header: Strings.get('stats_grammar_header', userData?.native_language)
                });
            }

            if (labels.includes('vocab')) {
                if (!result.errorType) {
                    result.errorType = 'vocab_error';
                }
                feedbackChunks.push({
                    type: 'vocab_diff',
                    original: userResponse,
                    corrected: evaluation.finalCorrectedText || userResponse,
                    header: Strings.get('stats_vocab_header', userData?.native_language)
                });
            }

            if (labels.includes('gibberish') && !result.errorType) {
                result.errorType = 'gibberish';
            }

            if (labels.includes('pragmatic_failure') && !result.errorType) {
                result.errorType = 'pragmatic_failure';
            }
            if ((labels.includes('too_formal') || labels.includes('too_informal')) && !result.errorType) {
                result.errorType = 'formality_error';
            }
            if (labels.includes('unnatural') && !result.errorType) {
                result.errorType = 'unidiomatic';
            }

            const cleanOriginal = userResponse.replace(/[^\w\s]/g, '').trim().toLowerCase();
            const cleanCorrected = result.correction.replace(/[^\w\s]/g, '').trim().toLowerCase();
            const displayCorrection = (cleanOriginal === cleanCorrected) ? "" : result.correction;

            const pragmaticsLabels = ['pragmatic_failure', 'too_formal', 'too_informal', 'unnatural', 'rude', 'insensitive', 'offensive'];
            if (displayCorrection && cleanCorrected.length > 0 && labels.some(l => pragmaticsLabels.includes(l))) {
                feedbackChunks.push({
                    type: 'pragmatics',
                    header: Strings.get('recommended_correction', userData?.native_language) || "Recommended Corrected Version",
                    message: "",
                    correction: displayCorrection
                });
            }

            result.explanations = feedbackChunks.filter(Boolean);
        }
        return result;
    }
    else if (stepData.responseType === "closedResponse") {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cueText.trim().toLowerCase());
        const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);
        const threshold = 95;
        let result = {
            isCorrect: similarity >= threshold,
            explanation: stepData.explanation,
            normalizeduserResponse,
            normalizedcue
        };
        return result;
    } else {
        let result = { isCorrect: false, explanation: stepData.explanation };
        return result;
    }
}

export async function validateAnswerPrecheck(val, cue, stepData, courseLevel, userData, responsesGiven) {
    if (stepData.responseType !== "openResponse") return { isValid: true };

    const cueText = typeof cue === 'object' ? cue?.en : cue;
    const wordCount = val.trim().split(/\s+/).length;
    let minWordsRequired = 3;
    let warningMessage = null;
    let isInvalid = false;

    const normalizeduserResponse = await normalize(val.trim().toLowerCase());
    const normalizedcue = await normalize(cueText.trim().toLowerCase());
    const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);

    if (responsesGiven && responsesGiven.includes(normalizeduserResponse)) {
        warningMessage = Strings.get('already_used', userData?.native_language);
        isInvalid = true;
    } else if (similarity >= 85) {
        warningMessage = Strings.get('no_repetition', userData?.native_language);
        isInvalid = true;
    } else {
        if (courseLevel.toUpperCase() === 'A2') { minWordsRequired = 4; }
        else if (courseLevel.toUpperCase() === 'B1') { minWordsRequired = 5; }
        else if (courseLevel.toUpperCase() === 'B2' || courseLevel.toUpperCase() === 'C1' || courseLevel.toUpperCase() === 'C2') { minWordsRequired = 6; }

        const isProfane = swearjar.profane(val);

        if (wordCount < minWordsRequired || isProfane) {
            isInvalid = true;
            if (isProfane) {
                warningMessage = Strings.get('inappropriate', userData?.native_language);
            } else {
                warningMessage = Strings.get(`min_words_${minWordsRequired}`, userData?.native_language) || Strings.get('min_words_3', userData?.native_language);
            }
        }
    }

    return isInvalid ? { isValid: false, warningMessage } : { isValid: true };
}