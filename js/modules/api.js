import { getCurrentUser, logout, tablesDB, APPWRITE_CONFIG } from './appwrite.js';
import normalize from './normalize.js';
import { QueryClient } from '@tanstack/query-core';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // Data never goes stale, no automatic background refetching
      gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
      retry: 2, // Retry failed requests twice
      refetchOnWindowFocus: false, // Prevent unnecessary DB reads when switching tabs
    },
  },
});

export async function isUserLoggedIn() {
  return queryClient.fetchQuery({
    queryKey: ['auth', 'status'],
    queryFn: async () => {
      try {
        const user = await getCurrentUser();
        return user !== null;
      } catch (error) {
        return false;
      }
    },
  });
}

export async function getUserProfile() {
  return queryClient.fetchQuery({
    queryKey: ['user', 'profile'],
    staleTime: Infinity,
    gcTime: 30 * 24 * 60 * 60 * 1000,
    queryFn: async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          const guestData = {
            $id: 'guest',
            email: 'guest@example.com',
            display_name: 'Guest User',
            join_date: new Date().toISOString(),
            auth_method: 'guest',
            english_level: 'A0',
            native_language: 'EN',
            completed_dates: []
          };
          console.log('[TanStack Query] Successfully fetched data for query: userProfileQuery', guestData);
          return guestData;
        }

        // Fetch extended profile data from the new TablesDB
        try {
          const profileDoc = await tablesDB.getRow({
            databaseId: APPWRITE_CONFIG.DATABASE_ID,
            tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
            rowId: user.$id // Assuming the row ID matches the user ID
          });

          // Merge core user account data with extended profile data
          const mergedData = {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite',
            ...profileDoc
          };
          console.log('[TanStack Query] Successfully fetched data for query: userProfileQuery', mergedData);
          return mergedData;
        } catch (dbError) {
          console.warn('Profile row not found, returning core user data', dbError);
          const coreData = {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite'
          };
          console.log('[TanStack Query] Successfully fetched data for query: userProfileQuery', coreData);
          return coreData;
        }
      } catch (error) {
        throw error;
      }
    }
  });
}

export const courseConfigQuery = (courseId) => ({
  queryKey: ['course', 'config', courseId],
  queryFn: async () => {
    const response = await fetch(`js/config/${courseId}.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch config for course ${courseId}`);
    }
    const data = await response.json();
    console.log('[TanStack Query] Successfully fetched data for query: courseConfigQuery', data);
    return data;
  },
  staleTime: Infinity,
  gcTime: 30 * 24 * 60 * 60 * 1000
});

export const currentLessonQuery = (courseId, lessonId) => ({
  queryKey: ['course', 'lesson', courseId, lessonId],
  queryFn: async () => {
    let configData = queryClient.getQueryData(['course', 'config', courseId]);

    if (!configData) {
      configData = await queryClient.fetchQuery(courseConfigQuery(courseId));
    }

    const lesson = configData.lessons.find(l => l.lessonId === lessonId);
    if (!lesson) {
      throw new Error(`Lesson ${lessonId} not found in course ${courseId}`);
    }
    console.log('[TanStack Query] Successfully fetched data for query: currentLessonQuery', lesson);
    return lesson;
  },
  staleTime: Infinity,
  gcTime: 30 * 24 * 60 * 60 * 1000
});

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

export async function checkGrammarWithAI(selectedAnswer, questionData) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  try {
    console.log("AI Evaluation: Starting Grammar Check...");
    const grammarPrompt = `Find all the grammatical error(s) in B's response, including if B does not agree with A in tense, number or gender. Return ONLY the grammar-corrected text of B's reply. If no errors, respond ONLY "CORRECT".  A: ${questionData.cue} B: ${selectedAnswer}`;

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
    const correctedTextRaw = (data.choices?.[0]?.message?.content || '').trim();
    let correctedText = correctedTextRaw;

    console.log("Grammar Check Result (Raw):", correctedTextRaw);

    // Robust "CORRECT" stripping: handles "CORRECT", "CORRECT.", "CORRECT: ", etc.
    if (/^correct[.!: \n-]*$/i.test(correctedText)) {
      correctedText = "";
    } else {
      // Strip "CORRECT:" or "CORRECT " prefix if followed by the actual correction
      correctedText = correctedText.replace(/^correct[:\s.-]+/i, '').trim();
    }

    // normalize is correctly awaited based on normalize.js being an async function
    const normOriginal = await normalize(selectedAnswer);
    const normCorrected = await normalize(correctedText);

    // It's correct if the AI literally said "CORRECT" (now empty string after stripping) 
    // or if the normalized versions match.
    const isGrammarCorrect = correctedText === '' ||
      normOriginal === normCorrected;

    return {
      isGrammarCorrect,
      correctedText: isGrammarCorrect ? selectedAnswer : (correctedText || selectedAnswer)
    };
  } catch (error) {
    console.error('Grammar AI Error:', error);
    throw error;
  }
}

export async function evaluateIntentWithAI(answerForIntentPass, questionData, lessonData) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  try {
    console.log("､AI Evaluation: Starting Intent Check...");

    // Updated prompt based on user instructions
    const intentPrompt = `Setting: ${lessonData.setting?.en || ''} 
A: ${lessonData.roleA?.en || ''} 
B: ${lessonData.roleB?.en || ''} 
B's goal: ${questionData.mission || 'Respond appropriately'} 
A: ${questionData.cue} 
B: ${answerForIntentPass} 
 
Evaluate B's response. Return ONLY an array with any applicable labels and any corrected version of B's response: [ungrammatical, pragmatic failure, too formal, too informal, rude, unidiomatic, correct].`;

    console.log("､役洟prompt to AI: ", intentPrompt);

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

    console.log("Intent Evaluation Raw Result:", rawIntentText);

    // Robust parsing: bypass JSON.parse entirely to avoid AI formatting errors
    const validLabels = ['PRAGMATIC FAILURE', 'TOO FORMAL', 'TOO INFORMAL', 'RUDE', 'UNIDIOMATIC', 'CORRECT'];
    let intentLabel = 'parse_error';
    const textUpper = rawIntentText.toUpperCase();

    for (const label of validLabels) {
      if (textUpper.includes(label)) {
        intentLabel = label.toLowerCase();
        break;
      }
    }

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

// Added lessonData to the parameters so it can be passed down correctly
export async function evaluateWithAI(selectedAnswer, normalizedSelectedAnswer, questionData, lessonData, userCefrLevel, uffApiDataRoot) {
  try {
    // Passed questionData here to prevent undefined errors
    const grammarResult = await checkGrammarWithAI(selectedAnswer, questionData);

    // Passed lessonData here to prevent undefined errors
    const intentResult = await evaluateIntentWithAI(grammarResult.correctedText, questionData, lessonData);

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

export function invalidateUserAndAuthCache() {
  queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
  queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
}

export async function signOut() {
  const result = await logout();
  localStorage.removeItem('wpLoggedIn');
  invalidateUserAndAuthCache();
  return result;
}