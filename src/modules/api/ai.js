// modules/api/ai.js
// Standalone AI evaluation and tutor functions.
// Uses raw fetch() — no TanStack Query, no Appwrite SDK.
// Extracted from api.js to keep the Appwrite SDK out of the main bundle.

import { getEnglish } from '../bilingual/bilingual-logic.js';

// 🤖🤖 Tutor

// Intentional raw fetch() without TanStack Query — one-shot AI inference (see evaluateWithAI).
export async function askEnglishTutor(conversationHistoryContext, newUserMessage) {
  const aiEndpoint = 'https://deepseek-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are strictly an English tutor. Answer the user's questions about English. The user is currently taking an English lesson. The context of their recent exercise is provided below. Use it to inform your answer if relevant."
          },
          {
            role: "user",
            content: `--- Context from Lesson ---\n${conversationHistoryContext}\n\n--- User Question ---\n${newUserMessage}`
          }
        ],
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Tutor API error ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    clearTimeout(timeout);
    let detail = '';
    if (error.name === 'AbortError') {
      detail = '(timeout - endpoint unreachable after 15s)';
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      detail = '(browser is offline)';
    } else if (error instanceof TypeError) {
      detail = '(network error - possible: endpoint down, CORS blocked, or ad blocker interfering)';
    } else if (error.message) {
      detail = `(${error.message})`;
    }
    console.error(`Tutor AI Error ${detail}:`, error);
    return "I'm sorry, I couldn't connect to the tutoring service right now. Please try again later.";
  }
}

// 🤖🤖LLM evaluation userResponse

const EVALUATION_SYSTEM_PROMPT = `You are a strict ESL evaluator. At the end of this prompt, you'll get a dialog (A and B) and a context string (CTX) containing the setting, roles, goals, and a minimum word count. Evaluate B's utterance only. Output ONLY one or more lines. Do not include markdown, preambles, explanations, JSON, arrays, or extra formatting. ### Rules: 1. If flawless: Output ONLY \`OK\` 2. If unintelligible: Output \`GIBBERISH\` 3. If errors exist: Output one line per item. * **For language errors**, write \`LABEL: Corrected text\` on one line. Maintain the minimum word count in your corrections. * ### Flag Labels * **RUDE** / **INSENSITIVE** / **OFFENSIVE** * **PRAGMATIC_FAILURE: (when B's utterance does not fit A's utterance or B's goal.)** These flag-label issues defy simple corrections so do not correct them, just write the label alone on one line. ### Correction Labels * **GRAMMAR:** Mechanical errors eg: modal verbs, irregular verb or plural form; tense, gender, number--including if B does not agree with A when agreement is required; syntax; missing/misplaced function words, BUT NOT other vocabulary errors. * **VOCAB:** Vocbulary errors, eg: simple word substitutions like "cup" for "cop", "loose" for "lose", "live" for "alive", "expect" for "hope"; garbled idioms ("sound and safe") or phrasal verbs ("get out bed"); innappropriate count form ("moneys" when they mean "money"); inappropriate connotation ("My puppy is a cute beast"). * **UNNATURAL:** Correct and meaningful but sounds awkward, unidiomatic or not native (such as L1 calques, unnecessary complexity, unlikely collocations in everyday settings), eg: "I see your sadness," "within a lapse of two hours," "travel by foot." * **TOO_FORMAL:** Diction too elevated for the context, eg: "Purchase a can of Coke"; "investigate new car options"; "if you would be so kind"; most uses of "shall". * **TOO_INFORMAL:** If much lower register than A's utterance, or unfit for the setting.  --- ### EXAMPLES **SCENARIO 1** \`CTX: supermarket. A=employee, B=customer, goal: buy paper towels. Min_words: 4\` \`A: Can I help you find anything?\` * If B: "I'm looking for paper towels." **Output:** \`OK\` * If B: "Paper towels blue here on where." **Output:** \`GIBBERISH\` * If B: "I seek a paper towels." **Output:** \`GRAMMAR: I seek some paper towels.\` \`UNNATURAL: I'm looking for some paper towels.\` * If B: "I look for towels of paper." **Output:** \`GRAMMAR: I'm looking for towels of paper.\` \`VOCAB: I'm looking for paper towels.\` * If B: "Kindly direct me to the paper towels." **Output:** \`TOO_FORMAL: Could you tell me where the paper towels are?\` * If B: "It a beautiful day." **Output:** \`GRAMMAR: It's a beautiful day.\` **SCENARIO 2** \`CTX: the park. A=friend, B=friend.\` \`A: Do you like it here?\` * If B: "I'm really enjoying it." **Output:** \`OK\` * If B: "I adore it here." **Output:** \`VOCAB: I love it here.\` * If B: "It is a place of beauty." **Output:** \`UNNATURAL: It's a beautiful place.\` * If B: "I finding it delighting." **Output:** \`GRAMMAR: I find it delighting.\` \`VOCAB: I find it delightful.\` \`TOO_FORMAL: I think it's wonderful.\` * If B: "It's not park very impressive." **Output:** \`GRAMMAR: It's not a very impressive park.\` \`RUDE\` **Misc** * \`A: My friend died.\` | \`B: That's too bad.\` **Output:** \`INSENSITIVE\` * \`A: Should I keep going?\` | \`B: You is in for a pound, in for a penny.\` **Output:** \`GRAMMAR: You are in for a pound, in for a penny.\` \`VOCAB: You are in for a penny, in for a pound.\` \`UNNATURAL: You're in for a penny, in for a pound.\` * \`A: We want to sing and dance with you.\` | \`B: No way, old dudes! You're way too old to sing and dance with us.\` **Output:** \`OFFENSIVE\``;

function deriveMinWords(courseLevel) {
  if (!courseLevel) return 3;
  const level = courseLevel.toUpperCase();
  if (level === 'A0' || level === 'A1') return 3;
  if (level === 'A2') return 4;
  if (level === 'B1') return 5;
  return 6;
}

function parseEvaluationResult(rawText) {
  const result = {
    labels: [],
    corrections: [],
    grammarCorrectedText: null,
    finalCorrectedText: null,
    isCorrect: false,
    isGibberish: false,
    rawOutput: rawText || ''
  };

  if (!rawText) return result;

  const text = rawText.trim();

  if (text === 'OK') {
    result.labels.push('correct');
    result.isCorrect = true;
    return result;
  }

  if (text === 'GIBBERISH') {
    result.labels.push('gibberish');
    result.isGibberish = true;
    return result;
  }

  if (text.startsWith('[')) {
    let array = null;
    try {
      array = JSON.parse(text);
    } catch {
      try {
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        const inner = lastBracket >= 0 ? text.substring(firstBracket, lastBracket + 1) : text.substring(firstBracket);
        const innerContent = inner.replace(/^\[/, '').replace(/\]$/, '').trim();
        const parts = innerContent.split(',').map(p => {
          let trimmed = p.trim().replace(/^"|"$/g, '');
          return `"${trimmed}"`;
        });
        array = JSON.parse(`[${parts.join(',')}]`);
      } catch {
        // fall through to line-based
      }
    }
    if (Array.isArray(array)) {
      for (const entry of array) {
        if (typeof entry !== 'string') continue;
        const colonIdx = entry.indexOf(':');
        if (colonIdx >= 0) {
          let label = entry.substring(0, colonIdx).trim().toLowerCase();
          const content = entry.substring(colonIdx + 1).trim();
          if (label === 'natural') label = 'unnatural';
          result.labels.push(label);
          result.corrections.push({ label, correctedText: content });
          if (label === 'grammar' && !result.grammarCorrectedText) {
            result.grammarCorrectedText = content;
          }
          result.finalCorrectedText = content;
        } else {
          const label = entry.trim().toLowerCase();
          if (label === 'correct') { result.isCorrect = true; }
          result.labels.push(label);
        }
      }
      result.isCorrect = result.labels.length === 1 && result.labels[0] === 'correct';
      result.isGibberish = result.labels.length === 1 && result.labels[0] === 'gibberish';
      return result;
    }
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx >= 0) {
      let label = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const content = trimmed.substring(colonIdx + 1).trim();
      if (label === 'natural') label = 'unnatural';
      result.labels.push(label);
      result.corrections.push({ label, correctedText: content });
      if (label === 'grammar' && !result.grammarCorrectedText) {
        result.grammarCorrectedText = content;
      }
      result.finalCorrectedText = content;
      continue;
    }

    if (trimmed.startsWith('[')) {
      const closeBracket = trimmed.indexOf(']');
      if (closeBracket >= 0) {
        let label = trimmed.substring(1, closeBracket).trim().toLowerCase();
        const content = trimmed.substring(closeBracket + 1).trim();
        if (label === 'natural') label = 'unnatural';
        if (content) {
          result.labels.push(label);
          result.corrections.push({ label, correctedText: content });
          if (label === 'grammar' && !result.grammarCorrectedText) {
            result.grammarCorrectedText = content;
          }
          result.finalCorrectedText = content;
        } else {
          if (label === 'ok') { result.labels.push('correct'); result.isCorrect = true; }
          else if (label === 'gibberish') { result.labels.push('gibberish'); result.isGibberish = true; }
          else { result.labels.push(label); }
        }
        continue;
      }
    }

    const label = trimmed.toLowerCase();
    if (label === 'ok') { result.labels.push('correct'); result.isCorrect = true; }
    else if (label === 'gibberish') { result.labels.push('gibberish'); result.isGibberish = true; }
    else { result.labels.push(label); }
  }

  result.isCorrect = result.isCorrect || (result.labels.length === 1 && result.labels[0] === 'correct');
  result.isGibberish = result.isGibberish || (result.labels.length === 1 && result.labels[0] === 'gibberish');

  return result;
}

// Intentional raw fetch() — one-shot AI inference. Every input is unique so
// caching via TanStack Query would be harmful (stale analysis for wrong answer).
export async function evaluateWithAI(userResponse, stepData, lessonData, courseLevel) {
  const aiEndpoint = 'https://deepseek-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const cueText = typeof stepData.cue === 'object' ? (stepData.cue?.en || '') : (stepData.cue || '');
    const setting = getEnglish(lessonData.setting) || '';
    const roleOther = getEnglish(lessonData.roleOther) || '';
    const roleUser = getEnglish(lessonData.roleUser) || '';
    const mission = getEnglish(lessonData.mission) || '';
    const minWords = deriveMinWords(courseLevel);

    const ctx = `CTX: ${setting}. A=${roleOther}, B=${roleUser}, goal: ${mission}. Min_words: ${minWords}`;
    const userPrompt = `${ctx}\n\nA: ${cueText}\nB: ${userResponse}`;

    const requestBody = {
      messages: [
        { role: "system", content: EVALUATION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1
    };

    console.log("[AI] Evaluation");
    console.log("[AI] Endpoint:", aiEndpoint);
    console.log("[AI] Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error("← HTTP error", response.status, body);
      throw new Error(`Evaluation API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    console.log("[AI] Full API response:", JSON.stringify(data, null, 2));

    const rawText = data.choices?.[0]?.message?.content?.trim() || '';
    console.log("[AI] Raw content:", rawText);

    if (!rawText) {
      console.warn("← Empty response — treating as evaluation error");
      return {
        labels: [],
        corrections: [],
        grammarCorrectedText: null,
        finalCorrectedText: null,
        isCorrect: false,
        isGibberish: false,
        rawOutput: ''
      };
    }

    const result = parseEvaluationResult(rawText);
    console.log("[AI] Parsed result:", JSON.stringify(result));
    return result;
  } catch (error) {
    clearTimeout(timeout);
    let detail = '';
    if (error.name === 'AbortError') {
      detail = '(timeout - endpoint unreachable after 15s)';
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      detail = '(browser is offline)';
    } else if (error instanceof TypeError) {
      detail = '(network error - possible: endpoint down, CORS blocked, or ad blocker interfering)';
    } else {
      detail = `(${error.message})`;
    }
    console.error(`Evaluation AI Error ${detail}:`, error);
    throw error;
  }
}
