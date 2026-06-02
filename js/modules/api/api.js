import { getCurrentUser, logout, tablesDB, APPWRITE_CONFIG } from './appwrite.js';
import { getGeoInfo } from '../media/geo-service.js'; // platform-resolved (web → ipapi.co fetch)

// Re-export so consumers can get the raw user object via api.js instead of appwrite.js directly
export { getCurrentUser };
import normalize from '../bilingual/normalize.js';
import { getEnglish } from '../bilingual/bilingual-logic.js';
import { QueryClient } from '@tanstack/query-core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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

export async function fetchGeoInfo() {
  return queryClient.fetchQuery({
    queryKey: ['geo', 'ip'],
    queryFn: async () => {
      const geo = await getGeoInfo();
      console.log('[api] fetchGeoInfo:', geo);
      return geo;
    },
    staleTime: 1000 * 60 * 60, // 1 hour — IP geolocation doesn't change mid-session
  });
}

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

export function invalidateUserAndAuthCache() {
  queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
  queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
}

export async function syncUserMetaDataMutation(metaToUpdate, userId) {
  try {
    try {
      await tablesDB.updateRow({
        databaseId: APPWRITE_CONFIG.DATABASE_ID,
        tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
        rowId: userId,
        data: metaToUpdate
      });
      console.log(`🚀 syncUserMetaDataMutation: Profile ${userId} successfully updated!`, metaToUpdate);
    } catch (updateError) {
      // If the row doesn't exist (404), fall back to upsertRow (PUT) to create it
      if (updateError.code === 404 || updateError.status === 404) {
        console.log(`ℹ️ syncUserMetaDataMutation: Profile ${userId} not found, creating new one.`);
        await tablesDB.upsertRow({
          databaseId: APPWRITE_CONFIG.DATABASE_ID,
          tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
          rowId: userId,
          data: metaToUpdate,
          permissions: [
            `read("user:${userId}")`,
            `update("user:${userId}")`,
            `delete("user:${userId}")`
          ]
        });
        console.log(`🚀 syncUserMetaDataMutation: Profile ${userId} successfully created!`, metaToUpdate);
      } else {
        throw updateError;
      }
    }

    // 🚀 Trigger cache bust globally after any successful profile write
    invalidateUserAndAuthCache();
  } catch (error) {
    console.error('🚨 Error syncing user meta data:', error);
  }
}

export async function signOut() {
  const result = await logout();
  invalidateUserAndAuthCache();
  return result;
}

// ── React Query hooks ──────────────────────────────────────────────
// These hooks provide reactive subscriptions for React components.
// Imperative functions above remain for non-React callers (homescreen.html, etc.).

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth', 'status'],
    queryFn: async () => {
      try {
        const user = await getCurrentUser();
        return user !== null;
      } catch {
        return false;
      }
    },
  });
}

export function useUserProfile() {
  return useQuery({
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
            profilepicurl: '/assets/img/userprofile.png'
          };
          console.log('[TanStack Query] Successfully fetched data for query: userProfileQuery', guestData);
          return guestData;
        }

        try {
          const profileDoc = await tablesDB.getRow({
            databaseId: APPWRITE_CONFIG.DATABASE_ID,
            tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
            rowId: user.$id
          });

          const mergedData = {
            $id: user.$id,
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
            $id: user.$id,
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

export function useSyncUserMetaData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ metaToUpdate, userId }) => {
      try {
        await tablesDB.updateRow({
          databaseId: APPWRITE_CONFIG.DATABASE_ID,
          tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
          rowId: userId,
          data: metaToUpdate
        });
        console.log(`🚀 useSyncUserMetaData: Profile ${userId} successfully updated!`, metaToUpdate);
      } catch (updateError) {
        if (updateError.code === 404 || updateError.status === 404) {
          console.log(`ℹ️ useSyncUserMetaData: Profile ${userId} not found, creating new one.`);
          await tablesDB.upsertRow({
            databaseId: APPWRITE_CONFIG.DATABASE_ID,
            tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
            rowId: userId,
            data: metaToUpdate,
            permissions: [
              `read("user:${userId}")`,
              `update("user:${userId}")`,
              `delete("user:${userId}")`
            ]
          });
          console.log(`🚀 useSyncUserMetaData: Profile ${userId} successfully created!`, metaToUpdate);
        } else {
          throw updateError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
    },
    onError: (error) => {
      console.error('🚨 useSyncUserMetaData error:', error);
    }
  });
}

// 🤖🤖 LLMs

// Intentional raw fetch() without TanStack Query — one-shot AI inference (see checkGrammarWithAI).
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
    // Intentional navigator.onLine — harmless error-detail fallback (see checkGrammarWithAI).
    // Guarded: in React Native navigator may not have onLine, so explicit false check.
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

// 🤖🤖LLM evaluation userResonse

const GRAMMAR_SYSTEM_PROMPT = `You are an English language error detector. Your only job is to find language errors (NOT logical errors) in B's response.

Check for the following error types:
1. Verb tense errors (e.g. "I goes" instead of "I go", "I will having" instead of "I will have")
2. Subject-verb agreement (e.g. "she go" instead of "she goes")
3. Number agreement (e.g. "two dog" instead of "two dogs")
4. Gender agreement where applicable
5. Article errors (e.g. "I want go" instead of "I want to go")
6. Auxiliary verb errors (e.g. "I am go" instead of "I am going")
7. Preposition errors that change grammatical correctness
8. Pronoun case errors (e.g. "me go" instead of "I go")
9. Tense agreement with the interlocutor's cue

Do NOT flag:
- Logical or factual errors
- Style or word choice issues unless grammatically wrong
- Punctuation or capitalisation

If there are no grammatical errors, respond ONLY with the word CORRECT.
If there are errors, respond ONLY with a corrected version of B's reply, minimum 5 words.
Do not explain. Do not add commentary. Do not repeat the question. Output only the corrected sentence or the word CORRECT.`;


const INTENT_SYSTEM_PROMPT = `Evaluate B's response. Return ONLY "CORRECT" or an array with any applicable labels [pragmatic failure, too formal, too informal, rude, unidiomatic] and a corrected version of B's response (minimum 5 words).`;

// Intentional raw fetch() — one-shot AI inference. Every input is unique so
// caching via TanStack Query would be harmful (stale analysis for wrong answer).
export async function checkGrammarWithAI(selectedAnswer, stepData) {
  const aiEndpoint = 'https://deepseek-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const cueText = typeof stepData.cue === 'object' ? (stepData.cue?.en || '') : (stepData.cue || '');
    const requestBody = {
      messages: [
  { role: "user", content: `${GRAMMAR_SYSTEM_PROMPT}\n\nA: ${cueText} B: ${selectedAnswer}` }
],
      temperature: 0.1
    };

    console.log("[AI] Grammar Check");
    console.log("[AI] Endpoint:", aiEndpoint);
    console.log("[AI] Request body:", JSON.stringify(requestBody, null, 2));
    console.log("[AI] System prompt:", GRAMMAR_SYSTEM_PROMPT);
    console.log("[AI] User message:", requestBody.messages[0].content);

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error("← HTTP error", response.status, body);
      throw new Error(`Grammar API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    console.log("[AI] Full API response:", JSON.stringify(data, null, 2));
    console.log("[AI] Model:", data.model);
    console.log("[AI] Usage:", JSON.stringify(data.usage));
    console.log("[AI] Cache hit tokens:", data.usage?.prompt_cache_hit_tokens ?? 'N/A');
    console.log("[AI] Cache miss tokens:", data.usage?.prompt_cache_miss_tokens ?? 'N/A');
    console.log("[AI] Finish reason:", data.choices?.[0]?.finish_reason);

    const correctedTextRaw = data.choices?.[0]?.message?.content?.trim() || '';
    console.log("[AI] Raw content:", correctedTextRaw);

    if (!correctedTextRaw) {
      console.warn("← Empty response — treating as grammar error, no correction available");
      return {
        isGrammarCorrect: false,
        correctedText: selectedAnswer
      };
    }

    let correctedText = correctedTextRaw;
    if (/^correct[.!: \n-]*$/i.test(correctedText)) {
      correctedText = "";
    } else {
      correctedText = correctedText.replace(/^correct[:\s.-]+/i, '').trim();
    }

    const normOriginal = await normalize(selectedAnswer);
    const normCorrected = await normalize(correctedText);

    const isGrammarCorrect = correctedText === '' || normOriginal === normCorrected;

    console.log("[AI] Normalized original:", normOriginal);
    console.log("[AI] Normalized corrected:", normCorrected);
    console.log("[AI] isGrammarCorrect:", isGrammarCorrect);
    console.log("[AI] Final correctedText:", isGrammarCorrect ? selectedAnswer : (correctedText || selectedAnswer));

    return {
      isGrammarCorrect,
      correctedText: isGrammarCorrect ? selectedAnswer : (correctedText || selectedAnswer)
    };
  } catch (error) {
    clearTimeout(timeout);
    let detail = '';
    if (error.name === 'AbortError') {
      detail = '(timeout - endpoint unreachable after 15s)';
    // Intentional navigator.onLine — just enriches error messages. In React Native
    // navigator may not have an onLine property, so guard with typeof check.
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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

// Intentional raw fetch() — one-shot AI inference (see checkGrammarWithAI).
export async function evaluateIntentWithAI(answerForIntentPass, stepData, lessonData) {
  const aiEndpoint = 'https://deepseek-proxy.joel-1cb.workers.dev';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const cueText = typeof stepData.cue === 'object' ? (stepData.cue?.en || '') : (stepData.cue || '');
    const intentUserPrompt = `Setting: ${getEnglish(lessonData.setting) || ''}
A: ${getEnglish(lessonData.roleOther) || ''}
B: ${getEnglish(lessonData.roleUser) || ''}
B's goal: ${getEnglish(lessonData.mission) || 'Respond appropriately'}
A: ${cueText}
B: ${answerForIntentPass}`;

    const requestBody = {
      messages: [
  { role: "user", content: `${INTENT_SYSTEM_PROMPT}\n\nSetting: ${getEnglish(lessonData.setting) || ''}
A: ${getEnglish(lessonData.roleOther) || ''}
B: ${getEnglish(lessonData.roleUser) || ''}
B's goal: ${getEnglish(lessonData.mission) || 'Respond appropriately'}
A: ${cueText}
B: ${answerForIntentPass}` }
],
      temperature: 0.1,
      max_tokens: 200
    };

    console.log("[AI] Intent Check");
    console.log("[AI] Endpoint:", aiEndpoint);
    console.log("[AI] Request body:", JSON.stringify(requestBody, null, 2));
    console.log("[AI] System prompt:", INTENT_SYSTEM_PROMPT);
    console.log("[AI] User message:", intentUserPrompt);

    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error("← HTTP error", response.status, body);
      throw new Error(`Intent API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();

    console.log("[AI] Full API response:", JSON.stringify(data, null, 2));
    console.log("[AI] Model:", data.model);
    console.log("[AI] Usage:", JSON.stringify(data.usage));
    console.log("[AI] Cache hit tokens:", data.usage?.prompt_cache_hit_tokens ?? 'N/A');
    console.log("[AI] Cache miss tokens:", data.usage?.prompt_cache_miss_tokens ?? 'N/A');
    console.log("[AI] Finish reason:", data.choices?.[0]?.finish_reason);

    const rawIntentText = data.choices?.[0]?.message?.content || '';
    console.log("[AI] Raw intent content:", rawIntentText);

    const validLabels = ['PRAGMATIC FAILURE', 'TOO FORMAL', 'TOO INFORMAL', 'RUDE', 'UNIDIOMATIC', 'CORRECT'];
    let intentLabel = 'parse_error';
    const textUpper = rawIntentText.toUpperCase();

    for (const label of validLabels) {
      if (textUpper.includes(label)) {
        intentLabel = label.toLowerCase();
        break;
      }
    }

    console.log("[AI] intentLabel:", intentLabel);
    console.log("[AI] isIntentCorrect:", intentLabel === 'correct');

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
    // Intentional navigator.onLine — harmless error-detail fallback (see checkGrammarWithAI).
    // Guarded: in React Native navigator may not have onLine, so explicit false check.
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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