import nlp from 'https://cdn.jsdelivr.net/npm/compromise@14.15.0/+esm';

/**
 * Calculates the syntactical complexity of a text using Compromise.js.
 * @param {string} text - The user response text.
 * @returns {object} - An object containing the complexity score and a breakdown.
 */
export function calculateSyntacticComplexity(text) {
    if (!text || text.trim().length === 0) {
        return { score: 0, breakdown: "No text provided" };
    }

    const doc = nlp(text);
    const sentences = doc.sentences();
    const sentenceCount = sentences.length || 1;
    
    // 1. Clause count (Compromise attempt at clause detection)
    const clauses = doc.clauses().length;
    
    // 2. Conjunctions (and, but, although, because, etc.)
    const conjunctions = doc.conjunctions().length;
    
    // 3. Prepositions (in, on, with, during, etc.)
    const prepositions = doc.prepositions().length;
    
    // 4. Adverbs (quickly, very, extremely, etc.)
    const adverbs = doc.adverbs().length;
    
    // 5. Word count
    const wordCount = doc.wordCount();
    
    // Syntactical Complexity Calculation:
    // We weight structural elements like clauses and conjunctions higher than word counts.
    let rawScore = 0;
    rawScore += (clauses / sentenceCount) * 20;      // Weight clauses heavily
    rawScore += (conjunctions / sentenceCount) * 15; // Conjunctions are good complexity markers
    rawScore += (prepositions / Math.max(1, wordCount)) * 100; // Prepositional density
    rawScore += (adverbs / Math.max(1, wordCount)) * 50;       // Adverb density
    rawScore += (wordCount / sentenceCount) * 2;     // Words per sentence

    // Normalize to 0-100 range. 
    // A simple sentence like "I am happy" scores low (~10-20).
    // A complex one like "I am happy because the sun is shining and I feel great" scores high (~60-80).
    const normalizedScore = Math.min(100, Math.round(rawScore * 1.5));

    const breakdown = `Clauses/Sent: ${(clauses/sentenceCount).toFixed(1)} | Conj: ${conjunctions} | Prep: ${prepositions}`;

    console.log(`🧠 Syntactic Complexity: ${normalizedScore}% | ${breakdown} | Adverbs: ${adverbs} | Words: ${wordCount}`);

    return {
        score: normalizedScore,
        breakdown: breakdown
    };
}
