import { calculateFluencyScore } from './js/modules/scoring.js';

// 1. Parser & Override Check:
const intentRaw = '["too formal", "correct", "This is corrected."]';
let evaluationResult = JSON.parse(intentRaw);
let correction = evaluationResult.pop();
let labels = evaluationResult.map(l => l.toLowerCase());
if (labels.length > 1 && labels.includes("correct")) {
    labels = labels.filter(l => l !== "correct");
}
console.log("Parser Check:");
console.log("Labels:", labels);
console.log("Correction:", correction);
console.log("Is Correct:", labels.length === 1 && labels.includes("correct"));
console.log("---");

// 2. Grammar Penalty Check: Simulate diff with 2 errors. Verify diff score = 50 (100 - 2 * 25), and final Grammar formula
const scoreData2 = calculateFluencyScore({
    pronunciationScore: 100, listeningScore: 100, wpm: 80, pauseCount: 0, wordCount: 10, idiomCount: 0, cefrLevel: 'A2',
    grammarErrors: 2, complexityScore: 100, labels: ["correct"], attemptNumber: 1
});
console.log("Grammar Check:");
console.log("Diff Score:", scoreData2.subScores.diffScore); // Should be 50
console.log("Grammar Score:", scoreData2.subScores.grammar); // Should be (50*2 + 100) / 3 = 66.666
console.log("---");

// 3. Flow Score Check: Simulate wpm=50, pauses=1. Verify wpmScore=0, pausesScore=50, flowScore=25
const scoreData3 = calculateFluencyScore({
    pronunciationScore: 100, listeningScore: 100, wpm: 50, pauseCount: 1, wordCount: 10, idiomCount: 0, cefrLevel: 'A2',
    grammarErrors: 0, complexityScore: 100, labels: ["correct"], attemptNumber: 1
});
console.log("Flow Check:");
console.log("WPM Score:", scoreData3.subScores.wpmScore); // Should be 0
console.log("Pauses Score:", scoreData3.subScores.pausesScore); // Should be 50
console.log("Flow Score:", scoreData3.subScores.flow); // Should be 25
console.log("---");

// 4. Attempt Logic Check: Simulate second attempt, grammar=100, flow=50. Verify final score uses lowest metric (50)
const scoreData4 = calculateFluencyScore({
    pronunciationScore: 100, listeningScore: 100, wpm: 60, pauseCount: 1, wordCount: 10, idiomCount: 0, cefrLevel: 'A2', // wpm=60->100, pause=1->50, flow=75
    grammarErrors: 0, complexityScore: 100, labels: ["correct"], attemptNumber: 2
});
// wait, flow is 75 above. Let's make flow 50.
const scoreData4_correct = calculateFluencyScore({
    pronunciationScore: 100, listeningScore: 100, wpm: 50, pauseCount: 0, wordCount: 10, idiomCount: 0, cefrLevel: 'A2', // wpm=50->0, pause=0->100, flow=50
    grammarErrors: 0, complexityScore: 100, labels: ["correct"], attemptNumber: 2
});
console.log("Attempt Logic Check:");
console.log("Attempt 2 Flow:", scoreData4_correct.subScores.flow);
console.log("Attempt 2 Grammar:", scoreData4_correct.subScores.grammar);
console.log("Attempt 2 Final Score:", scoreData4_correct.fluencyScore); // Should be 50
