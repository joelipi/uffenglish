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

export async function evaluateWithAI(userResponse, normalizeduserResponse, questionData, userCefrLevel, uffApiDataRoot) {
  try {
    const systemPrompt = `Assess B's response to A:\n"A: ${questionData.cue}\nB: ${userResponse}"\n\nReturn ONLY 1 array, NO OTHER TEXT. If ungrammatical (IGNORE PUNCTUATION), [ungrammatical,CORRECTED VERSION OF B]. Else: [insensitive],[nonsensical],[overly formal,ACCEPTABLE VERSION OF B]. If B is unrelated to A return [nonsequitur]. If B does not fully respond to A, return: [nonresponsive]. ELSE IF NONE OF THE PRECEDING APPLY: [CEFR level of B,""].`;

    const response = await fetch(uffApiDataRoot + 'mwai/v1/simpleTextQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer CogdexBearerToken' },
      body: JSON.stringify({ prompt: systemPrompt })
    });
    
    // Verbose Error Handling
    if (!response.ok) {
      let errorDetails = '';
      try { errorDetails = await response.text(); } catch (e) { errorDetails = 'Could not parse error response.'; }
      console.error(`🚨 AI API Failed! HTTP Status: ${response.status}`);
      console.error(`🚨 Server Error Details:\n`, errorDetails);
      throw new Error(`API error ${response.status}: ${errorDetails}`);
    }
    
    const responseData = await response.json();
    const rawText = responseData.data || '';
    
    let evaluationResult;
    try {
      let cleanedText = rawText.trim();
      const firstBracket = cleanedText.indexOf('[');
      if (firstBracket > 0) cleanedText = cleanedText.substring(firstBracket);
      const lastBracket = cleanedText.lastIndexOf(']');
      if (lastBracket !== -1 && lastBracket < cleanedText.length - 1) cleanedText = cleanedText.substring(0, lastBracket + 1);
      cleanedText = cleanedText.replace(/[""]/g, '"');
      cleanedText = cleanedText.replace(/\[([A-C][12]?),/g, '["$1",');
      cleanedText = cleanedText.replace(/\[([A-C][12]?)\]/g, '["$1"]');
      const errorTypes = ['ungrammatical', 'insensitive', 'nonsequitur', 'nonresponsive', 'overly formal', 'nonsensical'];
      for (const errorType of errorTypes) {
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${errorType}\\s*,`, 'gi'), `["${errorType}",`);
        cleanedText = cleanedText.replace(new RegExp(`\\[\\s*${errorType}\\s*\\]`, 'gi'), `["${errorType}"]`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${errorType}\\s*,`, 'gi'), `,"${errorType}",`);
        cleanedText = cleanedText.replace(new RegExp(`,\\s*${errorType}\\s*\\]`, 'gi'), `,"${errorType}"]`);
      }
      cleanedText = cleanedText.replace(/,\s*""\s*\]/g, ',""]');
      cleanedText = cleanedText.replace(/,\s*''\s*\]/g, `,""]`);
      cleanedText = cleanedText.replace(/'/g, '"');
      cleanedText = cleanedText.replace(/,,+/g, ',');
      cleanedText = cleanedText.replace(/,\s*\]/g, ']');
      evaluationResult = JSON.parse(cleanedText);
      if (!Array.isArray(evaluationResult) || evaluationResult.length < 1) throw new Error("Invalid array format");
    } catch (parseError) {
      try {
        const bracketMatch = rawText.match(/\[([^\]]*)\]/);
        if (bracketMatch) {
          const parts = bracketMatch[1].split(',').map(part => part.trim().replace(/^["']|["']$/g, '')).filter(part => part.length > 0); 
          if (parts.length > 0) evaluationResult = parts;
        }
      } catch (manualParseError) {}
      
      if (!evaluationResult) {
        const textUpper = rawText.toUpperCase();
        const cefrLevels = ['C2', 'C1', 'B2', 'B1', 'A2', 'A1'];
        for (const level of cefrLevels) {
          if (textUpper.includes(level)) return { isCorrect: true, errorType: level, cefrLevel: level, cefrLevelDeduction: 0, correction: '', explanation: '' };
        }
        if (textUpper.includes('UNGRAMMATICAL')) return { isCorrect: false, errorType: 'ungrammatical', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: 'Grammar error detected but correction not parseable' };
        if (textUpper.includes('INSENSITIVE')) return { isCorrect: false, errorType: 'insensitive', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: 'Insensitive response detected' };
        if (textUpper.includes('NONSEQUITUR')) return { isCorrect: false, errorType: 'nonsequitur', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: '' };
        if (textUpper.includes('NONRESPONSIVE')) return { isCorrect: false, errorType: 'nonresponsive', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: '' };
        if (textUpper.includes('OVERLY FORMAL') || textUpper.includes('OVERLYFORMAL')) return { isCorrect: false, errorType: 'overly formal', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: 'Response too formal but acceptable version not parseable' };
        if (textUpper.includes('NONSENSICAL') || textUpper.includes('NONSENS')) return { isCorrect: false, errorType: 'nonsensical', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: '' };
        return { isCorrect: false, errorType: 'parse_error', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: 'Could not parse AI response' };
      }
    }
    
    const errorType = evaluationResult[0];
    const secondElement = evaluationResult[1] || '';
    let isCorrect = false, cefrLevel = '', correction = '', explanation = '', cefrLevelDeduction = 0;
    
    if (errorType === 'ungrammatical') { isCorrect = false; correction = secondElement; } 
    else if (errorType === 'insensitive') { isCorrect = false; explanation = secondElement; } 
    else if (errorType === 'nonsequitur' || errorType === 'nonresponsive' || errorType === 'nonsensical') { isCorrect = false; } 
    else if (errorType === 'overly formal') { isCorrect = false; correction = secondElement; } 
    else {
      const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      if (cefrLevels.includes(errorType)) {
        isCorrect = true; cefrLevel = errorType;
        if (typeof userCefrLevel !== 'undefined') {
          const cefrLevelsWithA0 = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
          const userLevelIndex = cefrLevelsWithA0.indexOf(userCefrLevel);
          const answerLevelIndex = cefrLevelsWithA0.indexOf(cefrLevel);
          if (userLevelIndex !== -1 && answerLevelIndex !== -1) {
            const levelDifference = userLevelIndex - answerLevelIndex;
            if (levelDifference <= 2) cefrLevelDeduction = 0;
            else if (levelDifference === 3) cefrLevelDeduction = 20;
            else if (levelDifference === 4) cefrLevelDeduction = 40;
            else cefrLevelDeduction = 60;
          }
        }
      } else { isCorrect = false; }
    }
    return { isCorrect, errorType, cefrLevel, cefrLevelDeduction, correction, explanation };
  } catch (error) {
    console.error('🚨 AI Evaluation Error Caught:', error.message || error);
    return { isCorrect: false, errorType: 'api_error', cefrLevel: '', cefrLevelDeduction: 0, correction: '', explanation: '' };
  }
}