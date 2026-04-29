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

        const aiResult = await evaluateWithAI(userResponse, normalizeduserResponse, questionData, english_level, apiRoot);
        
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
