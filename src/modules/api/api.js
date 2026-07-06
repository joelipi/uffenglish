import { getCurrentUser, logout, tablesDB, APPWRITE_CONFIG, Query } from './appwrite.js';
import { getGeoInfo } from '../media/geo-service.js'; // platform-resolved (web → ipapi.co fetch)

// Re-export so consumers can get the raw user object via api.js instead of appwrite.js directly
export { getCurrentUser };
import normalize from '../bilingual/normalize.js';
import { getEnglish } from '../bilingual/bilingual-logic.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
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
            profilePictureUrl: defaultProfilePic // Default fallback
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
            profilePictureUrl: profileDoc?.profilePictureUrl || defaultProfilePic
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
            profilePictureUrl: defaultProfilePic
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
    console.log('[syncUserMetaData] Updating profile metadata...', { userId, metaToUpdate });
    try {
      await tablesDB.updateRow({
        databaseId: APPWRITE_CONFIG.DATABASE_ID,
        tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
        rowId: userId,
        data: metaToUpdate,
        permissions: [
          `read("any")`,
          `read("user:${userId}")`,
          `update("user:${userId}")`,
          `delete("user:${userId}")`
        ]
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
              `read("any")`,
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
    console.log('[syncUserMetaData] Invalidating cache...');
    invalidateUserAndAuthCache();
  } catch (error) {
    console.error('🚨 Error syncing user meta data:', error);
    throw error; // Re-throw so the mutation knows it failed
  }
}

export async function signOut() {
  const result = await logout();
  invalidateUserAndAuthCache();
  return result;
}

// ── React Query hooks ──────────────────────────────────────────────
// These hooks provide reactive subscriptions for React components.
// Imperative functions above remain for non-React callers (previous HTML pages, etc.).

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
            profilePictureUrl: defaultProfilePic
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
            profilePictureUrl: profileDoc?.profilePictureUrl || defaultProfilePic
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
            profilePictureUrl: defaultProfilePic
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
          data: metaToUpdate,
          permissions: [
            `read("any")`,
            `read("user:${userId}")`,
            `update("user:${userId}")`,
            `delete("user:${userId}")`
          ]
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
              `read("any")`,
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

export function useUserByShortCode(shortCode) {
  return useQuery({
    queryKey: ['user', 'profile', 'shortCode', shortCode],
    queryFn: async () => {
      const result = await tablesDB.listRows({
        databaseId: APPWRITE_CONFIG.DATABASE_ID,
        tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
        queries: [Query.equal('shortCode', shortCode)]
      });
      if (result.rows.length === 0) return null;
      return result.rows[0];
    },
    enabled: !!shortCode,
  });
}

// 🤖🤖 LLMs

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
    // Intentional navigator.onLine — harmless error-detail fallback (see evaluateWithAI).
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

  // Exact matches for simple outputs
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

  // If it looks like JSON (backward compat), try JSON parsing
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

  // Newline-delimited parsing (primary format)
  // Supports three formats per line:
  //   1. LABEL: corrected text         (colon format)
  //   2. [LABEL] corrected text        (bracket format)
  //   3. LABEL                          (standalone label: OK, GIBBERISH, RUDE, etc.)
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try colon format: LABEL: text
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

    // Try bracket format: [LABEL] corrected text   or   [LABEL]
    if (trimmed.startsWith('[')) {
      const closeBracket = trimmed.indexOf(']');
      if (closeBracket >= 0) {
        let label = trimmed.substring(1, closeBracket).trim().toLowerCase();
        const content = trimmed.substring(closeBracket + 1).trim();
        if (label === 'natural') label = 'unnatural';
        if (content) {
          // Bracket format with correction text: [vocab] I don't want to lose my keys.
          result.labels.push(label);
          result.corrections.push({ label, correctedText: content });
          if (label === 'grammar' && !result.grammarCorrectedText) {
            result.grammarCorrectedText = content;
          }
          result.finalCorrectedText = content;
        } else {
          // Standalone bracket label: [RUDE], [PRAGMATIC_FAILURE], [OK], [GIBBERISH]
          if (label === 'ok') { result.labels.push('correct'); result.isCorrect = true; }
          else if (label === 'gibberish') { result.labels.push('gibberish'); result.isGibberish = true; }
          else { result.labels.push(label); }
        }
        continue;
      }
      // Starts with [ but no closing bracket — fall through to raw label
    }

    // Raw label (no colon, not bracket-wrapped)
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
    console.log("[AI] System prompt:", EVALUATION_SYSTEM_PROMPT);
    console.log("[AI] User message:", userPrompt);

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
    console.log("[AI] Model:", data.model);
    console.log("[AI] Usage:", JSON.stringify(data.usage));
    console.log("[AI] Cache hit tokens:", data.usage?.prompt_cache_hit_tokens ?? 'N/A');
    console.log("[AI] Cache miss tokens:", data.usage?.prompt_cache_miss_tokens ?? 'N/A');
    console.log("[AI] Finish reason:", data.choices?.[0]?.finish_reason);

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
    // Intentional navigator.onLine — just enriches error messages. In React Native
    // navigator may not have an onLine property, so guard with typeof check.
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