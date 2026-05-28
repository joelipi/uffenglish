import { getCurrentUser, logout, tablesDB, APPWRITE_CONFIG } from './appwrite.js';
import normalize from './normalize.js';
import { getEnglish } from './bilingual-logic.js';
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
            completed_dates: [],
            profilepicurl: '/assets/img/userprofile.png' // Default fallback
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
            ...profileDoc,
            profilepicurl: profileDoc?.profilepicurl || '/assets/img/userprofile.png'
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
            auth_method: 'appwrite',
            profilepicurl: '/assets/img/userprofile.png'
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



export async function checkGrammarWithAI(selectedAnswer, stepData) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    console.log("AI Evaluation: Starting Grammar Check...");
    const grammarPrompt = `Find all the grammatical error(s) in B's response, including if B does not agree with A in tense, number or gender. Return ONLY the grammar-corrected text of B's reply. If no errors, respond ONLY "CORRECT".  A: ${stepData.cue.en} B: ${selectedAnswer}`;

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: "user", content: grammarPrompt }],
        temperature: 0.1
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Grammar API error ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    const correctedTextRaw = (data.choices?.[0]?.message?.content || '').trim();
    let correctedText = correctedTextRaw;

    console.log("Grammar Check Result (Raw):", correctedTextRaw);

    if (/^correct[.!: \n-]*$/i.test(correctedText)) {
      correctedText = "";
    } else {
      correctedText = correctedText.replace(/^correct[:\s.-]+/i, '').trim();
    }

    const normOriginal = await normalize(selectedAnswer);
    const normCorrected = await normalize(correctedText);

    const isGrammarCorrect = correctedText === '' ||
      normOriginal === normCorrected;

    return {
      isGrammarCorrect,
      correctedText: isGrammarCorrect ? selectedAnswer : (correctedText || selectedAnswer)
    };
  } catch (error) {
    clearTimeout(timeout);
    let detail = '';
    if (error.name === 'AbortError') {
      detail = '(timeout - endpoint unreachable after 15s)';
    } else if (!navigator.onLine) {
      detail = '(browser is offline)';
    } else if (error instanceof TypeError) {
      detail = '(network error - possible: endpoint down, CORS blocked, or ad blocker interfering)';
    } else {
      detail = `(${error.message})`;
    }
    console.error(`Grammar AI Error ${detail}:`, error);
    throw error;
  }
}

export async function evaluateIntentWithAI(answerForIntentPass, stepData, lessonData) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    console.log("AI Evaluation: Starting Intent Check...");

    const intentPrompt = `Setting: ${getEnglish(lessonData.setting) || ''} 
A: ${getEnglish(lessonData.roleOther) || ''} 
B: ${getEnglish(lessonData.roleUser) || ''} 
B's goal: ${getEnglish(lessonData.mission) || 'Respond appropriately'}
A: ${stepData.cue.en}
B: ${answerForIntentPass}
 
Evaluate B's response. Return ONLY an array with any applicable labels and any corrected version of B's response: [pragmatic failure, too formal, too informal, rude, unidiomatic, correct].`;

    console.log("[AI] prompt to AI: ", intentPrompt);

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: "user", content: intentPrompt }],
        temperature: 0.1
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Intent API error ${response.status}: ${body.slice(0, 200)}`);
    }
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
    clearTimeout(timeout);
    let detail = '';
    if (error.name === 'AbortError') {
      detail = '(timeout - endpoint unreachable after 15s)';
    } else if (!navigator.onLine) {
      detail = '(browser is offline)';
    } else if (error instanceof TypeError) {
      detail = '(network error - possible: endpoint down, CORS blocked, or ad blocker interfering)';
    } else {
      detail = `(${error.message})`;
    }
    console.error(`Intent AI Error ${detail}:`, error);
    throw error;
  }
}

export async function askEnglishTutor(conversationHistoryContext, newUserMessage) {
  const aiEndpoint = 'https://nvidia-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const systemPrompt = "You are strictly an English tutor. Answer the user's questions about English. The user is currently taking an English lesson. The context of their recent exercise is provided below. Use it to inform your answer if relevant.";

    const combinedPrompt = `${systemPrompt}\n\n--- Context from Lesson ---\n${conversationHistoryContext}\n\n--- User Question ---\n${newUserMessage}`;

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: "user", content: combinedPrompt }],
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
    } else if (!navigator.onLine) {
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