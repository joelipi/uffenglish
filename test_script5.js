import { calculateFluencyScore } from './js/modules/scoring.js';
console.log("Grammar test:", calculateFluencyScore({
    pronunciationScore: 100, listeningScore: 100, wpm: 80, pauseCount: 0, wordCount: 10, idiomCount: 0, cefrLevel: 'A2',
    grammarErrors: 2, complexityScore: 0, labels: ["correct"], attemptNumber: 1
}).subScores.grammar); // should be (50*2 + 0)/3 = 33.333...
