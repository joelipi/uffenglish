import { appStore } from "../store/store.js";

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
    hesitation,
    wordCount,
    idiomCount,
    courseLevel,
    grammarErrorScore,
    complexityScore,
    labels,
    attemptNumber,
    isTextMode = false
}) {
 
    // 1. Pronunciation (5%)
    const pronunciation = isTextMode ? null : pronunciationScore;
 
    // 2. Listening (40%)
    const listening = listeningScore;
 
    // 3. Flow (5%) - Updated as per hesitation-spec.md
    let flow = null;
    let wpmScore = null;
    let pausesScore = null;
    let hesitationScore = null;
 
    if (!isTextMode) {
        wpmScore = wpm < 60 ? 0 : 100;
        pausesScore = Math.max(0, 100 - (pauseCount * 50));
        // Spec calculation: deduct 10 points for every 1000ms (1 point per 100ms)
        // Subtracts 1000ms, ensures the value doesn't go below 0, then calculates the penalty
        hesitationScore = Math.max(0, 100 - Math.floor(Math.max(0, hesitation - 1000) / 100));
 
        const isDemoMode = appStore.getState().isDemoMode;
        if (isDemoMode) {
            // Average of ONLY WPM and Hesitation
            flow = Math.round((wpmScore + hesitationScore) / 2);
        } else {
            flow = Math.round((wpmScore + pausesScore + hesitationScore) / 3);
        }
    }

    // 4. Vocabulary (5%)
    let vocabScore = 100;
    let threshold = 0;
    if (courseLevel === 'B1') threshold = 1;
    else if (courseLevel === 'B2') threshold = 2;
    else if (courseLevel === 'C1' || courseLevel === 'C2') threshold = 3;

    if (courseLevel && idiomCount < threshold) {
        vocabScore = Math.max(0, 100 - ((threshold - idiomCount) * 25));
    }
    const vocabulary = vocabScore;

    // 5. Grammar (5%)
    const diffScore = grammarErrorScore !== undefined ? grammarErrorScore : 100;
    let grammar;

    if (['A0', 'A1', 'A2'].includes(courseLevel)) {
        grammar = diffScore;
    } else {
        grammar = ((diffScore * 2) + (complexityScore ?? 100)) / 3;
    }

    // 6. Formality (2.5%)
    const formality = (labels.includes("too_formal") || labels.includes("too_informal")) ? 0 : 100;

    // 7. Native-like (2.5%)
    const nativeLike = (labels.includes("unnatural") || labels.includes("vocab")) ? 0 : 100;

    // 8. Understanding (35%)
    const understanding = (labels.includes("pragmatic_failure") || labels.includes("rude") || labels.includes("insensitive") || labels.includes("offensive")) ? 0 : 100;

    let finalScore = 0;


    if (attemptNumber <= 1) {
        if (isTextMode) {
            // Pronunciation (5%) and Flow (5%) are skipped.
            // Remaining weights sum to 0.9 (90%).
            // We normalize by dividing the weighted sum by 0.9.
            const weightedSum = (listening * 0.40) +
                (vocabulary * 0.05) +
                (grammar * 0.05) +
                (formality * 0.025) +
                (nativeLike * 0.025) +
                (understanding * 0.35);
            finalScore = weightedSum / 0.9;
        } else {
            finalScore = (pronunciation * 0.05) +
                (listening * 0.40) +
                (flow * 0.05) +
                (vocabulary * 0.05) +
                (grammar * 0.05) +
                (formality * 0.025) +
                (nativeLike * 0.025) +
                (understanding * 0.35);
        }
    } else {
        if (isTextMode) {
            finalScore = Math.min(
                listening,
                vocabulary,
                grammar,
                formality,
                nativeLike,
                understanding
            );
        } else {
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
    }

    return {
        fluencyScore: Math.round(finalScore),
        flowScore: isTextMode ? null : Math.round(flow),
        subScores: {
            pronunciation: isTextMode ? null : pronunciation,
            listening,
            flow: isTextMode ? null : flow,
            wpmScore: isTextMode ? null : wpmScore,
            pausesScore: isTextMode ? null : pausesScore,
            hesitationScore: isTextMode ? null : hesitationScore,
            hesitation: isTextMode ? null : hesitation,
            vocabulary,
            grammar,
            diffScore,
            formality,
            nativeLike,
            understanding
        }
    };
}


export function logInteraction(cue, response, status, details = null, grammarCorrection = null, interactionLog = []) {
    try {
        const entry = { q: cue || "", r: response || "", s: status || "unk" };

        if (details && (!Array.isArray(details) || details.length > 0)) {
            entry.d = Array.isArray(details) ? details.join(', ') : details;
        }
        if (grammarCorrection) entry.g = grammarCorrection;

        interactionLog.push(entry);
    } catch (e) {
        console.warn("Failed to log interaction", e);
    }
}

export function getCompressedLessonStats({
    isTextMode = false,
    isCameraOff = false,
    lessonStartTime = null,
    averageWpm = null,
    totalPauses = null,
    totalHesitations = null,
    recognizedIdioms = [],
    pragmaticFlags = [],
    interactionLog = []
} = {}) {
    try {
        const state = appStore.getState() || {};

        const safeNum = (val, fallback = null) => {
            const parsed = Number(val);
            return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
        };

        let mode = 'cam';
        if (isTextMode) mode = 'txt';
        else if (isCameraOff) mode = 'mic';

        const tsEnd = new Date().toISOString();
        let tsStart = null;
        try {
            tsStart = lessonStartTime ? new Date(lessonStartTime).toISOString() : tsEnd;
        } catch (e) { tsStart = tsEnd; }

        const payload = {
            tss: tsStart,
            tse: tsEnd,
            mod: mode,

            // Core Zustand Metrics
            fs: safeNum(state.fluencyScore),
            ls: safeNum(state.listeningScore),
            ss: safeNum(state.speakingScore),
            fl: safeNum(state.flowScore),
            vs: safeNum(state.vocabularyScore),
            gs: safeNum(state.grammarScore),
            fm: safeNum(state.formalityScore),
            nl: safeNum(state.nativeLikeScore),
            us: safeNum(state.understandingScore),
            ia: safeNum(state.incorrectAttempts, 0),

            // Aggregated State Metrics
            wpm: safeNum(averageWpm),
            pau: safeNum(totalPauses),
            hes: safeNum(totalHesitations, 0),

            // Arrays
            ida: Array.isArray(recognizedIdioms) ? [...new Set(recognizedIdioms)] : [],
            idc: Array.isArray(recognizedIdioms) ? [...new Set(recognizedIdioms)].length : 0,
            prg: Array.isArray(pragmaticFlags) ? [...new Set(pragmaticFlags)] : [],
            hx: Array.isArray(interactionLog) ? interactionLog : []
        };

        // Minifier: Strip nulls, undefined, and empty arrays
        Object.keys(payload).forEach(key => {
            if (payload[key] === null || payload[key] === undefined) {
                delete payload[key];
            } else if (Array.isArray(payload[key]) && payload[key].length === 0) {
                delete payload[key];
            } else if (payload[key] === 0 && (key === 'hes' || key === 'idc')) {
                delete payload[key];
            }
        });

        return payload;

    } catch (error) {
        console.error("🚨 CRITICAL: Failed to compress lesson stats.", error);
        return { err: 1 }; // Explicit error flag
    }
}
