// --- modules/feedback-builder.js ---
// Pure, platform-agnostic feedback data structures.
// No DOM, no HTML — returns structured objects for any renderer to consume.

import Strings from '../data/strings.js';

/**
 * Builds an array of feedback section descriptors from scoring and analytics data.
 * Each section is a plain object that a platform-specific renderer can consume.
 *
 * @param {Object} params
 * @param {Object} params.scoreData - Output from calculateFluencyScore()
 * @param {Object} params.speechAnalytics - Speech analytics (wpm, pauseCount, foundIdioms, complexityScore)
 * @param {Object} params.result - Output from processAnswerLogic()
 * @param {Object} params.questionData - The current question object
 * @param {string} params.lang - User's native language code
 * @param {string} params.englishLevel - CEFR level string (A0-C2)
 * @param {number} params.attemptNumber - 1-based attempt count
 * @returns {{ sections: Array<Object> }}
 */
export function buildFeedbackData({ scoreData, speechAnalytics, result, questionData, lang, englishLevel, attemptNumber }) {
    const sections = [];

    // 1. Pronunciation
    sections.push({
        type: 'stat',
        key: 'pronunciation',
        header: `${Strings.get('stats_speaking_header', lang, { score: scoreData.subScores.pronunciation })} - ${Strings.get('stats_attempts_required', lang)} ${attemptNumber}`,
        parts: []
    });

    // 2. Listening
    sections.push({
        type: 'stat',
        key: 'listening',
        header: `${Strings.get('stats_listening_header', lang, { score: scoreData.subScores.listening })} - ${Strings.get('stats_repetitions_required', lang)} ${attemptNumber}`,
        parts: []
    });

    // 3. Flow
    const flowParts = [
        { label: Strings.get('stats_hesitation', lang), value: `${speechAnalytics.hesitation || 0}ms` },
        { label: Strings.get('stats_pauses_speaking', lang), value: (new URLSearchParams(window.location.search).has('demo')) ? "N/A" : (speechAnalytics.pauseCount || 0) },
        { label: Strings.get('stats_wpm', lang), value: speechAnalytics.wpm || 0 }
    ];

    if (new URLSearchParams(window.location.search).has('demo')) {
        flowParts.push({ type: 'notice', message: Strings.get('demo_vad_limitation_notice', lang) });
    }

    sections.push({
        type: 'stat',
        key: 'flow',
        header: `${Strings.get('stats_speech_flow_header', lang)} ${scoreData.subScores.flow}%`,
        parts: flowParts
    });

    // AI-only sections (4-9)
    if (questionData.inputType === 'ai') {
        // 4. Vocabulary
        const idiomCount = speechAnalytics.foundIdioms ? speechAnalytics.foundIdioms.length : 0;
        let idiomThreshold = 0;
        if (englishLevel === 'B1') idiomThreshold = 1;
        else if (englishLevel === 'B2') idiomThreshold = 2;
        else if (englishLevel === 'C1' || englishLevel === 'C2') idiomThreshold = 3;

        const vocabParts = [
            { label: `Idiom threshold (${englishLevel})`, value: idiomThreshold },
            { label: Strings.get('stats_idioms', lang), value: idiomCount }
        ];
        if (idiomCount > 0) {
            vocabParts.push({ label: 'Found', idioms: speechAnalytics.foundIdioms });
        }
        sections.push({
            type: 'stat',
            key: 'vocabulary',
            header: `${Strings.get('stats_vocabulary_header', lang)} ${scoreData.subScores.vocabulary}%`,
            parts: vocabParts
        });

        // 5. Grammar
        const grammarParts = [];
        if (speechAnalytics.complexityScore !== null) {
            grammarParts.push({ label: Strings.get('stats_complexity', lang), value: speechAnalytics.complexityScore });
        }
        const grammarDiffChunk = (result.explanations || []).find(e => e.type === 'grammar_diff');
        sections.push({
            type: 'grammar',
            key: 'grammar',
            header: `${Strings.get('stats_grammar_header', lang)} ${Math.round(scoreData.subScores.grammar)}%`,
            parts: grammarParts,
            diff: grammarDiffChunk ? { original: grammarDiffChunk.original, corrected: grammarDiffChunk.corrected } : null
        });

        // 6. Formality
        const formalityParts = [];
        if ((result.intentLabels || []).includes('too formal')) {
            formalityParts.push({ message: Strings.get('feedback_too_formal', lang) });
        } else if ((result.intentLabels || []).includes('too informal')) {
            formalityParts.push({ message: Strings.get('feedback_too_informal', lang) });
        }
        sections.push({
            type: 'stat',
            key: 'formality',
            header: `${Strings.get('stats_formality_header', lang)} ${scoreData.subScores.formality}%`,
            parts: formalityParts
        });

        // 7. Native-like
        const nativeLikeParts = [];
        if ((result.intentLabels || []).includes('unidiomatic')) {
            nativeLikeParts.push({ message: Strings.get('feedback_unidiomatic', lang) });
        }
        sections.push({
            type: 'stat',
            key: 'nativeLike',
            header: `${Strings.get('stats_native_like_header', lang)} ${scoreData.subScores.nativeLike}%`,
            parts: nativeLikeParts
        });

        // 8. Understanding
        const understandingParts = [];
        if ((result.intentLabels || []).includes('pragmatic failure')) {
            understandingParts.push({ message: Strings.get('feedback_pragmatic_failure', lang) });
        }
        if ((result.intentLabels || []).includes('rude')) {
            understandingParts.push({ message: Strings.get('feedback_rude', lang) });
        }
        sections.push({
            type: 'stat',
            key: 'understanding',
            header: `${Strings.get('stats_pragmatics_header', lang)} ${scoreData.subScores.understanding}%`,
            parts: understandingParts
        });

        // 9. Overall Fluency (prepended at top)
        sections.unshift({
            type: 'stat',
            key: 'fluency',
            header: `${Strings.get('stats_fluency_score', lang)} ${scoreData.fluencyScore}%`,
            isOverall: true,
            parts: []
        });
    }

    return { sections };
}

/**
 * Normalizes raw explanation chunks from answers.js into platform-agnostic descriptors.
 * Filters out grammar_diff (already handled in stats sections).
 *
 * @param {Array} explanations - Raw explanation chunks from processAnswerLogic()
 * @param {*} fallbackExplanation - Fallback from questionData.explanation
 * @returns {{ chunks: Array<Object>, useFallback: boolean }}
 */
export function buildExplanationData(explanations, fallbackExplanation) {
    if (!explanations || !Array.isArray(explanations)) {
        return { chunks: [], useFallback: true, fallback: fallbackExplanation };
    }

    const chunks = explanations
        .filter(chunk => chunk.type !== 'grammar_diff')
        .map(chunk => {
            if (typeof chunk === 'string') return { type: 'raw', content: chunk };
            switch (chunk.type) {
                case 'grammar_error':
                case 'intent_encouragement':
                    return { type: 'message', content: chunk.message };
                case 'pragmatics':
                    return { type: 'pragmatics', header: chunk.header, message: chunk.message, correction: chunk.correction };
                default:
                    return { type: 'unknown', raw: chunk };
            }
        })
        .filter(Boolean);

    return { chunks, useFallback: false, fallback: null };
}
