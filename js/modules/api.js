import { getCurrentUser, tablesDB, APPWRITE_CONFIG } from './appwrite.js';
import normalize from './normalize.js';

let userAuthCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 30000000; 

export async function isUserLoggedIn() {
  if (userAuthCache !== null && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_DURATION) return userAuthCache;
  try {
    const user = await getCurrentUser();
    const isLoggedIn = user !== null;
    userAuthCache = isLoggedIn;
    cacheTimestamp = Date.now();
    return isLoggedIn;
  } catch (error) { return false; }
}

export async function getUserProfile() {
  try {
    const user = await getCurrentUser();
    if (!user) {
        return {
            $id: 'guest',
            email: 'guest@example.com',
            display_name: 'Guest User',
            join_date: new Date().toISOString(),
            auth_method: 'guest',
            english_level: 'A0',
            native_language: 'EN',
            completed_dates: []
        };
    }

    // Fetch extended profile data from the new TablesDB
    try {
        const profileDoc = await tablesDB.getRow({
            databaseId: APPWRITE_CONFIG.DATABASE_ID,
            tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
            rowId: user.$id // Assuming the row ID matches the user ID
        });

        // Merge core user account data with extended profile data
        return {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite',
            ...profileDoc
        };
    } catch (dbError) {
        console.warn('Profile row not found, returning core user data', dbError);
        return {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite'
        };
    }
  } catch (error) { throw error; }
}

export async function getDeepgramToken() {
  try {
    const response = await fetch('https://magenta-shortbread-2f1be2.netlify.app/.netlify/functions/token', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`Failed to get token: ${response.status}`);
    const data = await response.json();
    if (!data.access_token) throw new Error('No access token received from server');
    return data.access_token;
  } catch (error) {
    console.error('Error getting Deepgram token:', error);
    throw error;
  }
}

export async function checkGrammarWithAI(selectedAnswer) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  try {
    console.log("🤖 AI Evaluation: Starting Grammar Check...");
    const grammarPrompt = `Return ONLY the corrected sentence OR "CORRECT": ${selectedAnswer}`;
    
    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: [{ role: "user", content: grammarPrompt }],
        temperature: 0.1
      })
    });
    
    if (!response.ok) throw new Error(`Grammar API error ${response.status}`);
    const data = await response.json();
    const correctedText = (data.choices?.[0]?.message?.content || '').trim();
    
    console.log("📝 Grammar Check Result:", correctedText);
    
    const normOriginal = await normalize(selectedAnswer);
    const normCorrected = await normalize(correctedText);
    const isGrammarCorrect = normCorrected === 'correct' || normOriginal === normCorrected;

    return {
      isGrammarCorrect,
      correctedText: isGrammarCorrect ? selectedAnswer : correctedText
    };
  } catch (error) {
    console.error('Grammar AI Error:', error);
    throw error;
  }
}

export async function evaluateIntentWithAI(answerForIntentPass, questionData) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  try {
    console.log("🤖 AI Evaluation: Starting Intent Check...");
    const intentPrompt = `B's goal: ${questionData.mission || 'Respond appropriately'}.
"A: ${questionData.cue}
B: ${answerForIntentPass}"
Evaluate B's response. Return ONLY an array with 1 or more applicable labels: [pragmatic failure, too formal, too informal, rude, correct].`;

    console.log("🤖🤖 prompt to AI: ", intentPrompt);

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: [{ role: "user", content: intentPrompt }],
        temperature: 0.1
      })
    });

    if (!response.ok) throw new Error(`Intent API error ${response.status}`);
    const data = await response.json();
    const rawIntentText = data.choices?.[0]?.message?.content || '';
    
    console.log("🎯 Intent Evaluation Raw Result:", rawIntentText);
    
    let evaluationResult;
    try {
      let cleanedText = rawIntentText.trim();
      const firstBracket = cleanedText.indexOf('[');
      if (firstBracket > 0) cleanedText = cleanedText.substring(firstBracket);
      const lastBracket = cleanedText.lastIndexOf(']');
      if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) cleanedText = cleanedText.substring(0, lastBracket + 1);
      cleanedText = cleanedText.replace(/[""]/g, '"').replace(/'/g, '"');
      const labels = ['pragmatic failure', 'too formal', 'too informal', 'rude', 'correct'];
      for (const label of labels) {
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${label}\\s*,`, 'gi'), `["${label}",`);
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${label}\\s*\\]`, 'gi'), `["${label}"]`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${label}\\s*,`, 'gi'), `,"${label}",`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${label}\\s*\\]`, 'gi'), `,"${label}"]`);
      }
      evaluationResult = JSON.parse(cleanedText);
    } catch (e) {
      const textUpper = rawIntentText.toUpperCase();
      if (textUpper.includes('PRAGMATIC FAILURE')) evaluationResult = ['pragmatic failure'];
      else if (textUpper.includes('TOO FORMAL')) evaluationResult = ['too formal'];
      else if (textUpper.includes('TOO INFORMAL')) evaluationResult = ['too informal'];
      else if (textUpper.includes('RUDE')) evaluationResult = ['rude'];
      else if (textUpper.includes('CORRECT')) evaluationResult = ['correct'];
      else evaluationResult = ['parse_error'];
    }

    const intentLabel = Array.isArray(evaluationResult) ? evaluationResult[0] : 'parse_error';
    return {
      isIntentCorrect: intentLabel === 'correct',
      intentLabel,
      rawIntentText
    };
  } catch (error) {
    console.error('Intent AI Error:', error);
    throw error;
  }
}

export async function evaluateWithAI(selectedAnswer, normalizedSelectedAnswer, questionData, userCefrLevel, uffApiDataRoot) {
  try {
    const grammarResult = await checkGrammarWithAI(selectedAnswer);
    const intentResult = await evaluateIntentWithAI(grammarResult.correctedText, questionData);

    return {
      isGrammarCorrect: grammarResult.isGrammarCorrect,
      correctedText: grammarResult.correctedText,
      isIntentCorrect: intentResult.isIntentCorrect,
      intentLabel: intentResult.intentLabel,
      rawIntentText: intentResult.rawIntentText,
      cefrLevel: 'B1',
      cefrLevelDeduction: 0
    };
  } catch (error) {
    console.error('Combined AI Evaluation Error:', error);
    return {
      isCorrect: false,
      errorType: 'api_error',
      cefrLevel: '',
      cefrLevelDeduction: 0,
      correction: '',
      explanation: ''
    };
  }
}