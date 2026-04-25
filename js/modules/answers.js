import normalize from './normalize.js';
import calculateSimilarity from './calculatesimilarity.js';
import swearjar from './swearjar.js';
import { evaluateWithAI } from './api.js';
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

export async function checkAnswerMatchParallel(normalizeduserResponse, currentLesson) {
    const questionsToCheck = currentLesson.questions.slice(2, 5);
    const cues = questionsToCheck.map(q => q.cue).filter(answer => answer);
    const normalizedcues = await Promise.all(cues.map(answer => normalize(answer)));
    return normalizedcues.includes(normalizeduserResponse);
}

export function isLastAiQuestionInLesson(lesson, currentIndex) {
    const aiQuestions = lesson.questions.filter(q => q.inputType === "ai");
    if (aiQuestions.length === 0) return false;
    const lastAiIndex = lesson.questions.findIndex(q => q === aiQuestions[aiQuestions.length - 1]);
    return currentIndex === lastAiIndex;
}

// 🛑 THE NEW EXTRACTED TIER 0 LOGIC
export async function runPreflightChecks({
    userResponse, cue, questionData, lesson, english_level, userData, cuesGiven
}) {
    let result = {
        isCorrect: false,
        explanation: "",
        translation: questionData.translation,
        userResponse: userResponse,
        normalizeduserResponse: "",
        normalizedcue: "",
        cefrLevel: "",
        cefrLevelDeduction: 0,
        errorType: ""
    };

    const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
    const normalizedcue = await normalize(cue.trim().toLowerCase());

    result.normalizeduserResponse = normalizeduserResponse;
    result.normalizedcue = normalizedcue;

    if (questionData.inputType === "ai") {
        if (cuesGiven.includes(normalizeduserResponse)) {
            result.explanation = Strings.get('already_used', userData?.native_language);
            return { passed: false, result };
        }

        const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);
        const threshold = 85;
        if (similarity >= threshold) {
            result.explanation = Strings.get('no_repetition', userData?.native_language);
            return { passed: false, result };
        }

        const wordCount = userResponse.trim().split(/\s+/).length;
        let minWordsRequired = 3;
        let warningMessage = Strings.get('min_words_3', userData?.native_language);

        if (english_level === 'A2') { minWordsRequired = 4; warningMessage = Strings.get('min_words_4', userData?.native_language); }
        else if (english_level === 'B1') { minWordsRequired = 5; warningMessage = Strings.get('min_words_5', userData?.native_language); }
        else if (english_level === 'B2' || english_level === 'C1' || english_level === 'C2') { minWordsRequired = 6; warningMessage = Strings.get('min_words_6', userData?.native_language); }

        if (wordCount < minWordsRequired) {
            result.explanation = warningMessage;
            return { passed: false, result };
        }

        if (questionData.possibleAnswer) {
            const matchesLessonAnswers = await checkAnswerMatchParallel(normalizeduserResponse, lesson);
            if (matchesLessonAnswers) {
                result.isCorrect = true;
                return { passed: false, result }; // It is correct, bypass AI
            }
        }

        const hasAsterisks = /\*{2,}/.test(userResponse);
        if (hasAsterisks) {
            result.explanation = Strings.get('censored', userData?.native_language);
            return { passed: false, result };
        }

        const isProfane = swearjar.profane(userResponse);
        if (isProfane) {
            result.explanation = Strings.get('inappropriate', userData?.native_language);
            return { passed: false, result };
        }
    }

    return { passed: true, normalizeduserResponse, normalizedcue, baseResult: result };
}

export async function processAnswerLogic({
    userResponse, cue, questionData, lesson, english_level, userData, cuesGiven, apiRoot
}) {
    if (questionData.inputType === "ai") {
        // Run preflight here too, just in case this is called directly
        const preflight = await runPreflightChecks({
            userResponse, cue, questionData, lesson, english_level, userData, cuesGiven
        });

        if (!preflight.passed) {
            return preflight.result;
        }

        let result = preflight.baseResult;
        const aiResult = await evaluateWithAI(userResponse, preflight.normalizeduserResponse, questionData, english_level, apiRoot);
        
        result.isCorrect = aiResult.isCorrect;
        if (result.isCorrect) {
            result.cefrLevel = aiResult.cefrLevel;
            result.cefrLevelDeduction = aiResult.cefrLevelDeduction;
        } else {
            result.errorType = aiResult.errorType;
            let aiExplanation = "";
            switch(aiResult.errorType) {
                case 'ungrammatical': aiExplanation = aiResult.correction ? `${Strings.get('lang_error_maybe', userData?.native_language)}<br>"${aiResult.correction}"` : Strings.get('lang_error_detected', userData?.native_language); break;
                case 'insensitive': aiExplanation = aiResult.explanation ? `${Strings.get('offensive_soften', userData?.native_language)}<br><span lang='${userData?.native_language || 'es'}'><i>${aiResult.explanation}</i></span>` : Strings.get('offensive_insensitive', userData?.native_language); break;
                case 'nonsensical': aiExplanation = Strings.get('no_sense', userData?.native_language); break;
                case 'nonsequitur': aiExplanation = Strings.get('not_logical', userData?.native_language); break;
                case 'nonresponsive': aiExplanation = Strings.get('not_deep', userData?.native_language); break;
                case 'overly formal': aiExplanation = aiResult.correction ? `${Strings.get('too_formal_less', userData?.native_language)}<br>"${aiResult.correction}"` : Strings.get('too_formal_context', userData?.native_language); break;
                case 'parse_error': aiExplanation = Strings.get('tech_error_retry', userData?.native_language); break;
                default: aiExplanation = Strings.get('tech_error_generic', userData?.native_language); break;
            }
            result.explanation = aiExplanation;
        }
        return result;
    }
    else if (questionData.inputType === "speech") {
        let result = { isCorrect: false, explanation: questionData.explanation };
        const normalizeduserResponse = await normalize(userResponse.trim().toLowerCase());
        const normalizedcue = await normalize(cue.trim().toLowerCase());
        const similarity = calculateSimilarity(normalizeduserResponse, normalizedcue);
        const threshold = 95;
        if (similarity >= threshold) {
            result.isCorrect = true;
            result.explanation = questionData.explanation;
        } else {
            result.isCorrect = false;
            result.explanation = questionData.explanation;
        }
        return result;
    } else {
        let result = { isCorrect: false, explanation: questionData.explanation };
        return result;
    }
}
