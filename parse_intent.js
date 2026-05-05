const rawIntentText = '["too formal", "correct", "This is corrected."]';
let evaluationResult;
try {
  let cleanedText = rawIntentText.trim();
  const firstBracket = cleanedText.indexOf('[');
  if (firstBracket > 0) cleanedText = cleanedText.substring(firstBracket);
  const lastBracket = cleanedText.lastIndexOf(']');
  if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) cleanedText = cleanedText.substring(0, lastBracket + 1);
  evaluationResult = JSON.parse(cleanedText);
} catch (e) {
  evaluationResult = [];
}
console.log(evaluationResult);
