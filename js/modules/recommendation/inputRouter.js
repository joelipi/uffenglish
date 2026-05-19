const NAVIGATION_KEYWORD_MAP = {
    'show me my streak':           'SHOW_STREAK',
    'find me a lesson':            'FIND_LESSON',
    'what should i study':         'FIND_LESSON',
    'skip this':                   'SKIP',
    "don't show me this again":    'NEVER',
    'never suggest this again':    'NEVER'
};

const ENGLISH_SIGNALS = [
    'grammar', 'pronunciation', 'vocabulary', 'spelling',
    'tense', 'verb', 'noun', 'sentence', 'word', 'phrase',
    'how do you say', 'what does', 'difference between',
    'is it correct', 'can i say', 'how to write'
];

const OUT_OF_SCOPE_TOPICS = [
    'weather', 'prices', 'sports', 'recipe', 'politics', 'religion'
];

export function normalise(input) {
    if (!input) return '';
    return input.trim().toLowerCase();
}

export function navigationClassifier(input) {
    const normalised = normalise(input);
    for (const [phrase, event] of Object.entries(NAVIGATION_KEYWORD_MAP)) {
        if (normalised.includes(phrase)) {
            return event;
        }
    }
    return null;
}

export function outOfScopeClassifier(input) {
    const normalised = normalise(input);

    // Length/structure heuristic
    if (normalised.length < 4 && !normalised.includes('?')) {
        return 'too_short';
    }

    // Topic keyword blocklist
    for (const topic of OUT_OF_SCOPE_TOPICS) {
        if (normalised.includes(topic)) {
            return 'out_of_scope_topic';
        }
    }

    // Language detection - heuristic character check if franc not available
    // We assume mostly English or basic latin characters for our scope
    // But since this is an ESL app, users might ask in their native language
    // So we don't aggressively block based on language without franc.

    return null;
}

export function englishTopicClassifier(input) {
    const normalised = normalise(input);
    for (const signal of ENGLISH_SIGNALS) {
        if (normalised.includes(signal)) {
            return true;
        }
    }
    return false;
}

export function routeInput(input) {
    const normalised = normalise(input);
    const originalInput = input;

    const navEvent = navigationClassifier(normalised);
    if (navEvent) {
        return {
            intent: 'navigation',
            navigationEvent: navEvent,
            confidence: 'high',
            originalInput
        };
    }

    const outOfScopeReason = outOfScopeClassifier(normalised);
    if (outOfScopeReason) {
        return {
            intent: 'out_of_scope',
            navigationEvent: null,
            confidence: 'high',
            originalInput,
            reason: outOfScopeReason
        };
    }

    const isEnglishTopic = englishTopicClassifier(normalised);
    if (isEnglishTopic) {
        return {
            intent: 'english',
            navigationEvent: null,
            confidence: 'high',
            originalInput
        };
    }

    // Ambiguous inputs go to AI
    return {
        intent: 'ambiguous',
        navigationEvent: null,
        confidence: 'low',
        originalInput
    };
}
