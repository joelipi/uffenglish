// modules/answers.js
import normalize from './normalize.js';
import calculateSimilarity from './calculate-similarity.js';
import swearjar from './swearjar.js';
import { checkGrammarWithAI, evaluateIntentWithAI } from './api.js';
import Strings from '../data/strings.js';

export function getCurrentQuestionIndex(questionData, configData, currentLessonIndex) {
    if (!configData || !configData.lessons || configData.lessons.length === 0) return -1;
    if (currentLessonIndex < 0 || currentLessonIndex >= configData.lessons.length) return -1;

    const currentLesson = configData.lessons[currentLessonIndex];
    return currentLesson.questions.findIndex(q =>
        q.question === questionData.question &&
        q.explanation === questionData.explanation &&
        q.cue === questionData.cue &&
        JSON.stringify(q.incues) === JSON.stringify(questionData.incues)
    );
}

export function isLastAiQuestionInLesson(lesson, currentIndex) {
    const aiQuestions = lesson.questions.filter(q => q.inputType === "ai");
    if (aiQuestions.length === 0) return false;
    const lastAiIndex = lesson.questions.findIndex(q => q === aiQuestions[aiQuestions.length - 1]);
    return currentIndex === lastAiIndex;
}

export async function processAnswerLogic({
    userResponse, cue, questionData, lesson, english_level, userData, cuesGiven, apiRoot
}) {
    if (questionData.inputType === "ai") {
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cue.trim().toLowerCase());

        let result = {
            isCorrect: false,
            explanation: "",
            translation: questionData.translation,
            userResponse: userResponse,
            normalizeduserResponse: normalizeduserResponse,
            normalizedcue: normalizedcue,
            cefrLevel: "",
            cefrLevelDeduction: 0,
            errorType: ""
        };

        // 1. Grammar Pass (Local fallback or AI)
        const grammarResult = await checkGrammarWithAI(userResponse, questionData);

        // 2. Intent Pass (AI)
        const intentResult = await evaluateIntentWithAI(grammarResult.correctedText, questionData, lesson);

        // --- NEW BUSINESS LOGIC: Robust Array Parsing ---
        let evaluationResult = [];
        try {
            let cleanedText = intentResult.rawIntentText.trim();
            const firstBracket = cleanedText.indexOf('[');
            if (firstBracket >= 0) cleanedText = cleanedText.substring(firstBracket);
            const lastBracket = cleanedText.lastIndexOf(']');
            if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) cleanedText = cleanedText.substring(0, lastBracket + 1);

            // Try to parse it as JSON
            evaluationResult = JSON.parse(cleanedText);
            if (!Array.isArray(evaluationResult)) {
                evaluationResult = [];
            }
        } catch (e) {
            console.error("Failed to parse AI intent result", e);
            evaluationResult = ["parse_error"];
        }

        let labels = [];
        let correction = "";

        if (evaluationResult.length > 0) {
            correction = evaluationResult.pop(); // The final string is the correction
            labels = evaluationResult.map(l => (typeof l === 'string' ? l.toLowerCase() : l));
        }

        // 2. The "Correct" Override
        if (labels.length > 1 && labels.includes("correct")) {
            labels = labels.filter(label => label !== "correct");
        }

        let isIntentCorrect = labels.length === 1 && labels.includes("correct");

        result.intentLabels = labels;
        result.isCorrect = isIntentCorrect;
        result.correction = correction || grammarResult.correctedText;

        if (result.isCorrect) {
            result.cefrLevel = 'B1';
            result.cefrLevelDeduction = 0;
            result.errorType = 'correct';
        } else {
            // --- ADDITIVE FEEDBACK LOGIC ---
            let feedbackChunks = [];

            if (labels.includes("ungrammatical")) {
                isIntentCorrect = false;
                result.isCorrect = false;
                result.errorType = 'ungrammatical';
                feedbackChunks.push({
                    type: 'grammar_diff',
                    original: userResponse,
                    corrected: result.correction,
                    header: Strings.get('stats_grammar_header', userData?.native_language)
                });
            } else {
                // Determine all specific pragmatic errors
                let intentExplanations = [];
                if (labels.includes("pragmatic failure")) {
                    intentExplanations.push(Strings.get('feedback_pragmatic_failure', userData?.native_language));
                }
                if (labels.includes("rude")) {
                    intentExplanations.push(Strings.get('feedback_rude', userData?.native_language));
                }
                if (labels.includes("too formal")) {
                    intentExplanations.push(Strings.get('feedback_too_formal', userData?.native_language));
                }
                if (labels.includes("too informal")) {
                    intentExplanations.push(Strings.get('feedback_too_informal', userData?.native_language));
                }
                if (labels.includes("unidiomatic")) {
                    intentExplanations.push(Strings.get('feedback_unidiomatic', userData?.native_language));
                }

                if (intentExplanations.length > 0) {
                    isIntentCorrect = false;
                    result.isCorrect = false;
                    result.errorType = labels[0] || 'intent_error';

                    // Join multiple explanations with a newline or space
                    const intentExplanation = intentExplanations.join("<br>");

                    feedbackChunks.push({
                        type: 'pragmatics',
                        header: Strings.get('stats_pragmatics_header', userData?.native_language),
                        message: intentExplanation,
                        correction: result.correction
                    });
                } else if (labels.length > 0 && !labels.includes("ungrammatical") && !labels.includes("correct")) {
                    isIntentCorrect = false;
                    result.isCorrect = false;
                    result.errorType = labels[0] || 'intent_error';
                    feedbackChunks.push({
                        type: 'pragmatics',
                        header: Strings.get('stats_pragmatics_header', userData?.native_language),
                        message: Strings.get('tech_error_generic', userData?.native_language),
                        correction: result.correction
                    });
                }
            }

            result.explanations = feedbackChunks.filter(Boolean);
        }
        return result;
    }
    else if (questionData.inputType === "speech") {
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cue.trim().toLowerCase());
        const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);
        const threshold = 95;
        let result = {
            isCorrect: similarity >= threshold,
            explanation: questionData.explanation,
            normalizeduserResponse,
            normalizedcue
        };
        return result;
    } else {
        let result = { isCorrect: false, explanation: questionData.explanation };
        return result;
    }
}

/**
 * Pre-submission validation for user answers.
 * Checks for duplicate responses, cue repetition, minimum word count by level, and profanity.
 * Only applies to inputType "ai" — all other types pass through immediately.
 * @param {string} val - The raw user input
 * @param {string} cue - The target cue phrase
 * @param {Object} questionData - The current question object
 * @param {string} englishLevel - e.g. 'A2', 'B1', 'B2'
 * @param {Object} userData - The user profile object
 * @param {string[]} cuesGiven - Array of already-used normalized responses
 * @returns {Promise<{ isValid: boolean, warningMessage?: string }>}
 */
export async function validateAnswerPrecheck(val, cue, questionData, englishLevel, userData, cuesGiven) {
    if (questionData.inputType !== "ai") return { isValid: true };

    const wordCount = val.trim().split(/\s+/).length;
    let minWordsRequired = 3;
    let warningMessage = null;
    let isInvalid = false;

    const normalizeduserResponse = await normalize(val.trim().toLowerCase());
    const normalizedcue = await normalize(cue.trim().toLowerCase());
    const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);

    if (cuesGiven && cuesGiven.includes(normalizeduserResponse)) {
        warningMessage = Strings.get('already_used', userData?.native_language);
        isInvalid = true;
    } else if (similarity >= 85) {
        warningMessage = Strings.get('no_repetition', userData?.native_language);
        isInvalid = true;
    } else {
        if (englishLevel === 'A2') { minWordsRequired = 4; }
        else if (englishLevel === 'B1') { minWordsRequired = 5; }
        else if (englishLevel === 'B2' || englishLevel === 'C1' || englishLevel === 'C2') { minWordsRequired = 6; }

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