// modules/api.js
import { getCurrentUser, tablesDB, APPWRITE_CONFIG } from './appwrite.js';

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
    if (!user) throw new Error('Not logged in');

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

export async function evaluateWithAI(selectedAnswer, normalizedSelectedAnswer, questionData, userCefrLevel, uffApiDataRoot) {
  // Define the new proxy endpoint
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';

  try {
    console.log("🤖 AI Evaluation: Starting Pass 1 (Grammar Check)...");
    
    // Pass 1: Grammar Check
    const grammarPrompt = `Return ONLY the corrected sentence OR "CORRECT": ${selectedAnswer}`;
    
    const grammarResponse = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Cloudflare handles the Authorization header securely
      },
      body: JSON.stringify({ 
        messages: [{ role: "user", content: grammarPrompt }],
        temperature: 0.1 // Keeping temperature low for strict grammar correction
      })
    });
    
    if (!grammarResponse.ok) {
        let errorDetails = '';
        try { errorDetails = await grammarResponse.text(); } catch (e) { errorDetails = 'Could not parse error response.'; }
        console.error(`🚨 Grammar AI API Failed! HTTP Status: ${grammarResponse.status}`);
        console.error(`🚨 Server Error Details:\n`, errorDetails);
        throw new Error(`Grammar API error ${grammarResponse.status}: ${errorDetails}`);
    }
    const grammarData = await grammarResponse.json();
    
    // Parse the nested OpenAI-style response format
    const correctedText = (grammarData.choices?.[0]?.message?.content || '').trim();
    
    console.log("📝 Grammar Check Result:", correctedText);
    
    const isGrammarCorrect = correctedText.toUpperCase() === 'CORRECT' || correctedText.toLowerCase() === selectedAnswer.toLowerCase();
    const answerForIntentPass = isGrammarCorrect ? selectedAnswer : correctedText;

    console.log("🤖 AI Evaluation: Starting Pass 2 (Intent Check)...");

    // Pass 2: Intent Evaluation
    const intentPrompt = `B's goal: ${questionData.mission || 'Respond appropriately'}.
"A: ${questionData.cue}
B: ${answerForIntentPass}"
Evaluate B's response. Return ONLY an array with 1 or more applicable labels: [pragmatic failure, too formal, too informal, rude, correct].`;

    console.log("🤖🤖prompt to AI: ", intentPrompt);

    const intentResponse = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        messages: [{ role: "user", content: intentPrompt }],
        temperature: 0.1 // Keeping temperature low for classification
      })
    });

    if (!intentResponse.ok) {
        let errorDetails = '';
        try { errorDetails = await intentResponse.text(); } catch (e) { errorDetails = 'Could not parse error response.'; }
        console.error(`🚨 Intent AI API Failed! HTTP Status: ${intentResponse.status}`);
        console.error(`🚨 Server Error Details:\n`, errorDetails);
        throw new Error(`Intent API error ${intentResponse.status}: ${errorDetails}`);
    }
    const intentData = await intentResponse.json();
    
    // Parse the nested OpenAI-style response format
    const rawIntentText = intentData.choices?.[0]?.message?.content || '';
    
    console.log("🎯 Intent Evaluation Raw Result:", rawIntentText);
    
    // Parse the array response with robust extraction
    let evaluationResult;
    try {
      let cleanedText = rawIntentText.trim();
      const firstBracket = cleanedText.indexOf('[');
      if (firstBracket > 0) cleanedText = cleanedText.substring(firstBracket);
      const lastBracket = cleanedText.lastIndexOf(']');
      if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) cleanedText = cleanedText.substring(0, lastBracket + 1);
      
      cleanedText = cleanedText.replace(/[""]/g, '"').replace(/'/g, '"');
      
      // Robust labels matching
      const labels = ['pragmatic failure', 'too formal', 'too informal', 'rude', 'correct'];
      for (const label of labels) {
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${label}\\s*,`, 'gi'), `["${label}",`);
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${label}\\s*\\]`, 'gi'), `["${label}"]`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${label}\\s*,`, 'gi'), `,"${label}",`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${label}\\s*\\]`, 'gi'), `,"${label}"]`);
      }

      evaluationResult = JSON.parse(cleanedText);
    } catch (e) {
      console.warn("Parsing failed, using fallback extraction");
      const textUpper = rawIntentText.toUpperCase();
      if (textUpper.includes('PRAGMATIC FAILURE')) evaluationResult = ['pragmatic failure'];
      else if (textUpper.includes('TOO FORMAL')) evaluationResult = ['too formal'];
      else if (textUpper.includes('TOO INFORMAL')) evaluationResult = ['too informal'];
      else if (textUpper.includes('RUDE')) evaluationResult = ['rude'];
      else if (textUpper.includes('CORRECT')) evaluationResult = ['correct'];
      else evaluationResult = ['parse_error'];
    }

    const intentLabel = Array.isArray(evaluationResult) ? evaluationResult[0] : 'parse_error';
    const isIntentCorrect = intentLabel === 'correct';
    
    // Final Combined Result
    return {
      isCorrect: isGrammarCorrect && isIntentCorrect,
      errorType: !isGrammarCorrect ? 'ungrammatical' : (isIntentCorrect ? 'correct' : intentLabel),
      cefrLevel: isGrammarCorrect && isIntentCorrect ? 'B1' : '', // Fallback level
      cefrLevelDeduction: 0,
      correction: !isGrammarCorrect ? correctedText : '',
      explanation: !isIntentCorrect ? `Intent evaluation: ${intentLabel}` : ''
    };

  } catch (error) {
    console.error('AI Evaluation Error:', error);
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