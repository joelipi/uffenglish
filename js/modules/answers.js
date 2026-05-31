// modules/answers.js
import normalize from './normalize.js';
import calculateSimilarity from './calculate-similarity.js';
import swearjar from './swearjar.js';
import { checkGrammarWithAI, evaluateIntentWithAI } from './api.js';
import Strings from '../data/strings.js';
import { appStore } from './store.js';

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
    userResponse, cue, stepData, lesson, englishLevel, userData, apiRoot
}) {
    if (stepData.stepType === "openResponse") {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cueText.trim().toLowerCase());

        let result = {
            isCorrect: false,
            explanation: "",
            translation: stepData.translation,
            userResponse: userResponse,
            normalizeduserResponse: normalizeduserResponse,
            normalizedcue: normalizedcue,
            cefrLevel: "",
            cefrLevelDeduction: 0,
            errorType: ""
        };

        // 1. Grammar Pass (Local fallback or AI)
        let grammarResult, intentResult;
        try {
            grammarResult = await checkGrammarWithAI(userResponse, stepData);
            intentResult = await evaluateIntentWithAI(grammarResult.correctedText, stepData, lesson);
        } catch (apiError) {
            console.error('[processAnswerLogic] AI API error, returning api_error result:', apiError);
            result.errorType = 'api_error';
            return result;
        }

        // --- NEW BUSINESS LOGIC: Robust Array Parsing ---
        let evaluationResult = [];
        let cleanedText = intentResult.rawIntentText.trim();
        let appendedCorrection = "";

        try {
            const firstBracket = cleanedText.indexOf('[');
            if (firstBracket >= 0) cleanedText = cleanedText.substring(firstBracket);
            const lastBracket = cleanedText.lastIndexOf(']');
            if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) {
                appendedCorrection = cleanedText.substring(lastBracket + 1).trim();
                cleanedText = cleanedText.substring(0, lastBracket + 1);
            }

            try {
                // 1. Try strict JSON parse first
                evaluationResult = JSON.parse(cleanedText);
            } catch (e) {
                // 2. Pre-process for common AI formatting mistakes (missing quotes)
                // Strip outer brackets, split by comma, trim and quote each part individually
                let innerContent = cleanedText.replace(/^\[/, '').replace(/\]$/, '').trim();
                let parts = innerContent.split(',').map(p => {
                    let trimmed = p.trim().replace(/^"|"$/g, ''); // strip existing quotes if partial
                    return `"${trimmed}"`;
                });
                let fixedText = `[${parts.join(',')}]`;
                console.log('[Intent Parse] Fixed unquoted array:', fixedText);
                evaluationResult = JSON.parse(fixedText);
            }

            if (!Array.isArray(evaluationResult)) {
                evaluationResult = [];
            }
        } catch (e) {
            console.warn("Failed to JSON parse AI intent result, falling back to manual split", e);

            // 3. Ultimate fallback for severely malformed strings
            let innerText = cleanedText.replace(/^\[/, '').replace(/\]$/, '').trim();

            if (innerText.toLowerCase() === 'correct') {
                evaluationResult = ["correct"];
            } else {
                const firstCommaIdx = innerText.indexOf(',');
                if (firstCommaIdx !== -1) {
                    evaluationResult = [
                        innerText.substring(0, firstCommaIdx).trim().replace(/^"|"$/g, ''),
                        innerText.substring(firstCommaIdx + 1).trim().replace(/^"|"$/g, '')
                    ];
                } else {
                    evaluationResult = [innerText.replace(/^"|"$/g, '')];
                }
            }
        }

        let labels = [];
        let correction = "";

        if (evaluationResult.length > 0) {
            const validLabelsSet = new Set(['ungrammatical', 'pragmatic failure', 'too formal', 'too informal', 'rude', 'unidiomatic', 'correct', 'parse_error']);

            // 1. Try to extract correction from the end of the array
            const lastEl = evaluationResult[evaluationResult.length - 1];
            if (typeof lastEl === 'string' && !validLabelsSet.has(lastEl.trim().toLowerCase())) {
                correction = evaluationResult.pop();
            }

            // 2. Filter the rest for valid labels
            labels = evaluationResult
                .filter(l => typeof l === 'string' && validLabelsSet.has(l.trim().toLowerCase()))
                .map(l => l.toLowerCase().trim());

            // 3. Handle appended correction (text after the brackets)
            if (appendedCorrection) {
                correction = appendedCorrection.replace(/^"|"$/g, '').trim();
            }

            // 4. Default correction if we just have "correct" or "parse_error"
            if (!correction && labels.length === 1 && (labels.includes("correct") || labels.includes("parse_error"))) {
                correction = grammarResult.correctedText;
            }
        }

        // 2. The "Correct" Override
        if (labels.length > 1 && labels.includes("correct")) {
            labels = labels.filter(label => label !== "correct");
        }

        console.log('[Intent Parse] Final labels:', JSON.stringify(labels), '| Correction:', correction, '| Appended:', appendedCorrection);

        // --- TWO-TRACK EVALUATION ---
        let isGrammarCorrect = true;
        if (grammarResult.isGrammarCorrect === false) {
            isGrammarCorrect = false;
            if (grammarResult.correctedText) {
                const cleanOriginal = userResponse.replace(/[^\w\s]/g, '').trim().toLowerCase();
                const cleanCorrected = grammarResult.correctedText.replace(/[^\w\s]/g, '').trim().toLowerCase();
                if (cleanOriginal === cleanCorrected && cleanOriginal !== '') {
                    isGrammarCorrect = true;
                }
            }
        } else if (grammarResult.correctedText) {
            const cleanOriginal = userResponse.replace(/[^\w\s]/g, '').trim().toLowerCase();
            const cleanCorrected = grammarResult.correctedText.replace(/[^\w\s]/g, '').trim().toLowerCase();
            if (cleanOriginal !== cleanCorrected && cleanOriginal !== '') {
                isGrammarCorrect = false;
            }
        }

        let isIntentCorrect = labels.length === 1 && labels.includes("correct");

        result.intentLabels = labels;
        result.isCorrect = isGrammarCorrect && isIntentCorrect;
        result.correction = correction || grammarResult.correctedText;

        if (result.isCorrect) {
            result.cefrLevel = 'B1';
            result.cefrLevelDeduction = 0;
            result.errorType = 'correct';
        } else {
            let feedbackChunks = [];
            result.errorType = null;

            // 1. SEPARATE BUBBLE: Grammar
            if (!isGrammarCorrect || labels.includes("ungrammatical")) {
                result.errorType = 'ungrammatical';
                feedbackChunks.push({
                    type: 'grammar_diff',
                    original: userResponse,
                    corrected: grammarResult.correctedText,
                    header: Strings.get('stats_grammar_header', userData?.native_language)
                });
            }

            // 2. Set errorType for intent labels (feedback text is now in stats bubbles in app.js)
            if (labels.includes("pragmatic failure")) {
                if (!result.errorType) result.errorType = 'pragmatic_failure';
            }
            if (labels.includes("too formal") || labels.includes("too informal")) {
                if (!result.errorType) result.errorType = 'formality_error';
            }
            if (labels.includes("unidiomatic")) {
                if (!result.errorType) result.errorType = 'unidiomatic';
            }

            // 3. RECOMMENDED CORRECTED VERSION (single consolidated bubble)
            const cleanOriginal = userResponse.replace(/[^\w\s]/g, '').trim().toLowerCase();
            const cleanCorrected = result.correction.replace(/[^\w\s]/g, '').trim().toLowerCase();
            const displayCorrection = (cleanOriginal === cleanCorrected) ? "" : result.correction;

            if (displayCorrection && cleanCorrected.length > 0 && labels.some(l => ["pragmatic failure", "too formal", "too informal", "unidiomatic", "rude"].includes(l))) {
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
    else if (stepData.stepType === "closedResponse") {
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

export async function validateAnswerPrecheck(val, cue, stepData, englishLevel, userData, responsesGiven) {
    if (stepData.stepType !== "openResponse") return { isValid: true };

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
        if (englishLevel.toUpperCase() === 'A2') { minWordsRequired = 4; }
        else if (englishLevel.toUpperCase() === 'B1') { minWordsRequired = 5; }
        else if (englishLevel.toUpperCase() === 'B2' || englishLevel.toUpperCase() === 'C1' || englishLevel.toUpperCase() === 'C2') { minWordsRequired = 6; }

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