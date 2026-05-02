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
