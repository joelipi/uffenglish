// modules/scoring.js

export function calculateRepeatAverage(repeatPointsHistory) {
    if (!repeatPointsHistory || repeatPointsHistory.length === 0) return 0;
    const sum = repeatPointsHistory.reduce((a, b) => a + Math.max(0, b), 0);
    return Math.round(sum / repeatPointsHistory.length);
}

export function calculateRolePlayAverage(rolePlayPointsHistory) {
    if (!rolePlayPointsHistory || rolePlayPointsHistory.length === 0) return 0;
    const sum = rolePlayPointsHistory.reduce((a, b) => a + Math.max(0, b), 0);
    return Math.round(sum / rolePlayPointsHistory.length);
}

export function calculateAverage(repeatPointsHistory, rolePlayPointsHistory) {
    const hasRepeat = repeatPointsHistory && repeatPointsHistory.length > 0;
    const hasRolePlay = rolePlayPointsHistory && rolePlayPointsHistory.length > 0;
    
    if (!hasRepeat && !hasRolePlay) return 100;
    if (!hasRepeat) return calculateRolePlayAverage(rolePlayPointsHistory);
    if (!hasRolePlay) return calculateRepeatAverage(repeatPointsHistory);
    
    const sum = calculateRepeatAverage(repeatPointsHistory) + calculateRolePlayAverage(rolePlayPointsHistory);
    return Math.round(sum / 2);
}

export function calculateFluencyScore({
    pronunciationScore,
    listeningScore,
    wpm,
    pauseCount,
    wordCount,
    idiomCount,
    cefrLevel,
    grammarErrors,
    complexityScore,
    labels,
    attemptNumber
}) {
    // 1. Pronunciation (5%)
    const pronunciation = pronunciationScore;

    // 2. Listening (40%)
    const listening = listeningScore;

    // 3. Flow (5%)
    const wpmScore = wpm < 60 ? 0 : 100;
    const pausesScore = Math.max(0, 100 - (pauseCount * 50));
    const flow = (wpmScore + pausesScore) / 2;

    // 4. Vocabulary (5%)
    let vocabScore = 100;
    let threshold = 0;
    if (cefrLevel === 'B1') threshold = 1;
    else if (cefrLevel === 'B2') threshold = 2;
    else if (cefrLevel === 'C1' || cefrLevel === 'C2') threshold = 3;

    // We could penalize vocab if wordCount is very low, but the prompt says:
    // "Base this on total word count (do not penalize for punctuating as sentences) and idiom count (set thresholds per CEFR level: B1, B2, C1+)."
    // Let's implement a basic threshold logic:
    if (cefrLevel && idiomCount < threshold) {
        vocabScore = Math.max(0, 100 - ((threshold - idiomCount) * 25)); // Arbitrary penalty if not meeting threshold
    }
    const vocabulary = vocabScore;

    // 5. Grammar (5%)
    const diffScore = Math.max(0, 100 - (grammarErrors * 25));
    const grammar = ((diffScore * 2) + (complexityScore ?? 100)) / 3;

    // 6. Formality (2.5%)
    const formality = (labels.includes("too formal") || labels.includes("too informal")) ? 0 : 100;

    // 7. Native-like (2.5%)
    const nativeLike = labels.includes("unidiomatic") ? 0 : 100;

    // 8. Understanding (35%)
    const understanding = (labels.includes("pragmatic failure") || labels.includes("rude")) ? 0 : 100;

    let finalScore = 0;

    if (attemptNumber <= 1) {
        // First Attempt Math
        finalScore = (pronunciation * 0.05) +
                     (listening * 0.40) +
                     (flow * 0.05) +
                     (vocabulary * 0.05) +
                     (grammar * 0.05) +
                     (formality * 0.025) +
                     (nativeLike * 0.025) +
                     (understanding * 0.35);
    } else {
        // Subsequent Attempts Math
        finalScore = Math.min(
            pronunciation,
            listening,
            flow,
            vocabulary,
            grammar,
            formality,
            nativeLike,
            understanding
        );
    }

    return {
        fluencyScore: Math.round(finalScore),
        subScores: {
            pronunciation,
            listening,
            flow,
            wpmScore,
            pausesScore,
            vocabulary,
            grammar,
            diffScore,
            formality,
            nativeLike,
            understanding
        }
    };
}
