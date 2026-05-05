import { idiomChecker } from './idiom-checker.js';

export async function analyzeSpeech(text, netDuration, pauseCount, currentCourseLevel, inputType) {
    let wpm = null;
    let complexityScore = null;
    let complexityScoreBreakdown = null;
    let foundIdioms = [];

    if (netDuration != null && netDuration > 0) {
        // Words per minute calculation
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
        wpm = Math.round((wordCount / netDuration) * 60);
    }

    // Only calculate complexity and idioms for AI roleplay questions
    if (currentCourseLevel !== 'A1' && inputType === 'ai') {
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
        const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;

        // Match syllables
        const syllables = text.match(/[aeiouy]{1,2}/gi);
        const syllableCount = syllables ? syllables.length : 0;

        // Flesch-Kincaid Reading Ease approx
        let baseScore = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / (wordCount || 1)) - 15.59;
        baseScore = Math.max(0, baseScore); // Prevent negative baseline

        if (!idiomChecker.isReady) await idiomChecker.init();
        const idiomResult = idiomChecker.count(text);
        const idiomCount = typeof idiomResult === 'object' ? idiomResult.count : idiomResult;
        foundIdioms = typeof idiomResult === 'object' ? idiomResult.foundIdioms : [];

        if (idiomCount === 1) {
            baseScore += 15;
        } else if (idiomCount > 1) {
            baseScore += 25;
        }

        complexityScore = Math.round(baseScore);
        complexityScoreBreakdown = `Words/Sentence: ${(wordCount/sentenceCount).toFixed(1)} | Syllables/Word: ${(syllableCount/(wordCount||1)).toFixed(1)} | Idioms: ${idiomCount}`;
    }

    return {
        wpm,
        pauseCount,
        complexityScore,
        complexityScoreBreakdown,
        foundIdioms: typeof foundIdioms !== 'undefined' ? foundIdioms : []
    };
}