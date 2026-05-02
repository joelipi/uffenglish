import normalize from './normalize.js';
import calculateSimilarity from './calculate-similarity.js';
import swearjar from './swearjar.js';
import { checkGrammarWithAI, evaluateIntentWithAI } from './api.js';
import { createGrammarDiffHTML, createPragmaticsBubbleHTML, createHeaderHTML } from '../components/ui.js';
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
        
        // --- BUSINESS LOGIC: Determine final state from raw results ---
        const isGrammarCorrect = grammarResult.isGrammarCorrect;
        const isIntentCorrect = intentResult.isIntentCorrect;
        
        result.isCorrect = isGrammarCorrect && isIntentCorrect;
        result.correction = grammarResult.correctedText;

        if (result.isCorrect) {
            result.cefrLevel = 'B1';
            result.cefrLevelDeduction = 0;
            result.errorType = 'correct';
        } else {
            // --- ADDITIVE FEEDBACK LOGIC ---
            let feedbackChunks = [];

            // 1. Grammar Feedback (Always shown if grammar is bad)
            if (!isGrammarCorrect) {
                if (result.correction) {
                    feedbackChunks.push(createGrammarDiffHTML(userResponse, result.correction, Strings.get('stats_grammar_header', userData?.native_language)));
                } else {
                    feedbackChunks.push(Strings.get('lang_error_detected', userData?.native_language));
                }
            }

            // 2. Intent Feedback
            if (isIntentCorrect) {
                // If grammar was bad but intent was good, show the specific encouragement
                if (!isGrammarCorrect) {
                    feedbackChunks.push(Strings.get('intent_good_grammar_bad', userData?.native_language));
                }
                result.errorType = 'grammar_bad_intent_good';
            } else {
                // Intent is bad. Determine the specific intent message
                const label = intentResult.intentLabel || 'parse_error';
                result.errorType = isGrammarCorrect ? label : 'grammar_and_intent_bad';
                
                let intentExplanation = "";
                switch(label) {
                    case 'insensitive': 
                    case 'rude':
                        intentExplanation = intentResult.rawIntentText ? `${Strings.get('offensive_soften', userData?.native_language)}<br><span lang='${userData?.native_language || 'es'}'><i>${intentResult.rawIntentText}</i></span>` : Strings.get('offensive_insensitive', userData?.native_language); break;
                    case 'nonsensical': intentExplanation = Strings.get('no_sense', userData?.native_language); break;
                    case 'nonsequitur': 
                    case 'pragmatic failure':
                        intentExplanation = Strings.get('not_logical', userData?.native_language); break;
                    case 'nonresponsive': intentExplanation = Strings.get('not_deep', userData?.native_language); break;
                    case 'overly formal': 
                    case 'too formal':
                        intentExplanation = Strings.get('too_formal_context', userData?.native_language); break;
                    case 'too informal': intentExplanation = Strings.get('too_informal', userData?.native_language) || "That's a bit too informal for this situation."; break;
                    case 'parse_error': intentExplanation = Strings.get('tech_error_retry', userData?.native_language); break;
                    default: intentExplanation = Strings.get('tech_error_generic', userData?.native_language); break;
                }
                feedbackChunks.push(createPragmaticsBubbleHTML(createHeaderHTML(Strings.get('stats_pragmatics_header', userData?.native_language)), intentExplanation));
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
