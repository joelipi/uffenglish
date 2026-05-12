import { State } from "./state.js";
import { appStore } from "./store.js";

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
    cefrLevel,
    grammarErrorScore,
    complexityScore,
    labels,
    attemptNumber
}) {
    // 1. Pronunciation (5%)
    const pronunciation = pronunciationScore;

    // 2. Listening (40%)
    const listening = listeningScore;

    // 3. Flow (5%) - Updated as per hesitation-spec.md
    const wpmScore = wpm < 60 ? 0 : 100;
    const pausesScore = Math.max(0, 100 - (pauseCount * 50));
    
    // Spec calculation: 100 score up to 500ms, then deduct 5 points for every 100ms
    const hesitationScore = Math.max(0, 100 - Math.floor(Math.max(0, hesitation - 500) / 20));
    
    const isDemoMode = new URLSearchParams(window.location.search).has('demo');
    let flow;
    if (isDemoMode) {
        // Average of ONLY WPM and Hesitation
        flow = Math.round((wpmScore + hesitationScore) / 2);
    } else {
        flow = Math.round((wpmScore + pausesScore + hesitationScore) / 3);
    }

    // 4. Vocabulary (5%)
    let vocabScore = 100;
    let threshold = 0;
    if (cefrLevel === 'B1') threshold = 1;
    else if (cefrLevel === 'B2') threshold = 2;
    else if (cefrLevel === 'C1' || cefrLevel === 'C2') threshold = 3;
    
    if (cefrLevel && idiomCount < threshold) {
        vocabScore = Math.max(0, 100 - ((threshold - idiomCount) * 25));
    }
    const vocabulary = vocabScore;

    // 5. Grammar (5%)
    const diffScore = grammarErrorScore !== undefined ? grammarErrorScore : 100;
    let grammar;
    
    if (['A0', 'A1', 'A2'].includes(cefrLevel)) {
        grammar = diffScore;
    } else {
        grammar = ((diffScore * 2) + (complexityScore ?? 100)) / 3;
    }

    // 6. Formality (2.5%)
    const formality = (labels.includes("too formal") || labels.includes("too informal")) ? 0 : 100;

    // 7. Native-like (2.5%)
    const nativeLike = labels.includes("unidiomatic") ? 0 : 100;

    // 8. Understanding (35%)
    const understanding = (labels.includes("pragmatic failure") || labels.includes("rude")) ? 0 : 100;

    let finalScore = 0;

    if (attemptNumber <= 1) {
        finalScore = (pronunciation * 0.05) + 
                     (listening * 0.40) + 
                     (flow * 0.05) + 
                     (vocabulary * 0.05) + 
                     (grammar * 0.05) + 
                     (formality * 0.025) + 
                     (nativeLike * 0.025) + 
                     (understanding * 0.35);
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

    return {
        fluencyScore: Math.round(finalScore),
        flowScore: Math.round(flow),
        subScores: {
            pronunciation,
            listening,
            flow,
            wpmScore,
            pausesScore,
            hesitationScore,
            hesitation,
            vocabulary,
            grammar,
            diffScore,
            formality,
            nativeLike,
            understanding
        }
    };
}


export function logInteraction(cue, response, status, details = null, grammarCorrection = null) {
    try {
        const entry = { q: cue || "", r: response || "", s: status || "unk" };

        if (details && (!Array.isArray(details) || details.length > 0)) {
            entry.d = Array.isArray(details) ? details.join(', ') : details;
        }
        if (grammarCorrection) entry.g = grammarCorrection;

        State.interactionLog.push(entry);
    } catch (e) {
        console.warn("Failed to log interaction", e);
    }
}

export function getCompressedLessonStats() {
    try {
        const state = appStore.getState() || {};

        const safeNum = (val, fallback = null) => {
            const parsed = Number(val);
            return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
        };

        let mode = 'cam';
        if (State.isTextMode) mode = 'txt';
        else if (State.isCameraOff) mode = 'mic';

        const tsEnd = new Date().toISOString();
        let tsStart = null;
        try {
            tsStart = State.lessonStartTime ? new Date(State.lessonStartTime).toISOString() : tsEnd;
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
            wpm: safeNum(State.averageWpm),
            pau: safeNum(State.totalPauses),
            hes: safeNum(State.totalHesitations, 0),

            // Arrays
            ida: Array.isArray(State.recognizedIdioms) ? [...new Set(State.recognizedIdioms)] : [],
            prg: Array.isArray(State.pragmaticFlags) ? [...new Set(State.pragmaticFlags)] : [],
            hx: Array.isArray(State.interactionLog) ? State.interactionLog : []
        };

        // Minifier: Strip nulls, undefined, and empty arrays
        Object.keys(payload).forEach(key => {
            if (payload[key] === null || payload[key] === undefined) {
                delete payload[key];
            } else if (Array.isArray(payload[key]) && payload[key].length === 0) {
                delete payload[key];
            } else if (payload[key] === 0 && key === 'hes') {
                delete payload[key];
            }
        });

        return payload;

    } catch (error) {
        console.error("🚨 CRITICAL: Failed to compress lesson stats.", error);
        return { err: 1 }; // Explicit error flag
    }
}
