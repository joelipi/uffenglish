import { getCurrentUser, getCurrentSession, logout, supabase } from './supabase.js';
import { getGeoInfo } from '../media/geo-service.js';
import { normalizeFriendIds } from '../user/friends-logic.js';
import { resolveNotificationRefreshOptions } from '../notifications/notification-refresh-logic.js';

export { getCurrentUser };
import defaultProfilePic from '../../assets/img/userprofile.png';
import { QueryClient } from '@tanstack/query-core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Column mapping: Appwrite camelCase -> Supabase snake_case
function toDbColumns(meta) {
  const map = {
    profilePictureUrl: 'profile_picture_url',
    firstName: 'first_name',
    lastName: 'last_name',
    native_language: 'native_language',
    english_level: 'english_level',
    completed_dates: 'completed_dates',
    course_progress: 'course_progress',
    lesson_scores: 'lesson_scores',
    lessons_completed: 'lessons_completed',
    counted_lessons: 'counted_lessons',
    friends: 'friends',
    referrals: 'referrals',
    friend_owners: 'friend_owners',
    total_fluency_sum: 'total_fluency_sum',
    recent_fluency_avgs: 'recent_fluency_avgs',
    last_lesson_timestamp: 'last_lesson_timestamp',
    signup_ip: 'signup_ip',
    country: 'country',
    region: 'region',
    city: 'city',
    referrer: 'referrer',
    friendCode: 'friend_code',
    shareCode: 'share_code',
    email: 'email',
    firstName_trim: 'first_name',
    joinDate: 'join_date',
    accountStatus: 'account_status',
  };
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    const col = map[k] || k;
    // Handle special keys that Supabase uses snake_case for but Appwrite used mixed
    if (k === 'shareCode') out['share_code'] = v;
    else if (k === 'profilePictureUrl') out['profile_picture_url'] = v;
    else if (k === 'firstName') out['first_name'] = v;
    else if (k === 'lastName') out['last_name'] = v;
    else if (k === 'friendCode') out['friend_code'] = v;
    else if (k === 'joinDate') out['join_date'] = v;
    else out[col] = v;
  }
  return out;
}

function fromDbRow(row) {
  if (!row) return null;
  return {
    ...row,
    // Back-compat camelCase aliases so existing UI keeps working
    profilePictureUrl: row.profile_picture_url,
    profile_picture_url: row.profile_picture_url,
    firstName: row.first_name,
    lastName: row.last_name,
    friendCode: row.friend_code,
    shareCode: row.share_code,
    friendLinks: row.friend_links,
    joinDate: row.join_date,
    completed_dates: row.completed_dates || [],
    recent_fluency_avgs: row.recent_fluency_avgs || [],
    counted_lessons: row.counted_lessons || [],
    friends: row.friends || [],
    referrals: Number(row.referrals) || 0,
    friend_owners: row.friend_owners || [],
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
      refetchOnWindowFocus: false,
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
    staleTime: 1000 * 60 * 60,
  });
}

export async function isUserLoggedIn() {
  return queryClient.fetchQuery({
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
            email: 'i@izs.me',
            display_name: 'Guest User',
            join_date: new Date().toISOString(),
            auth_method: 'supabase',
            english_level: 'A0',
            native_language: 'EN',
            completed_dates: [],
            profilePictureUrl: defaultProfilePic
          };
          // For guest compatibility keep 'guest' auth_method but also accept supabase
          guestData.auth_method = 'guest';
          console.log('[TanStack Query] Successfully fetched data for query: userProfileQuery', guestData);
          return guestData;
        }

        try {
          const { data: row, error } = await supabase.from('user_profiles').select('*').eq('id', user.$id).single();
          if (error) throw error;
          const profileDoc = fromDbRow(row);
          const mergedData = {
            $id: user.$id,
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'supabase',
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
            auth_method: 'supabase',
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

/**
 * Read the identity columns of a profile row, distinguishing "no row" from
 * "the read failed".
 *
 * `useUserProfile` cannot do this: its catch block wraps the whole select and
 * falls back to a core-data object, so a transient network, timeout or RLS
 * error returns an object that is INDISTINGUISHABLE from a missing row. Deciding
 * to write a repair from that object would overwrite a healthy profile whenever
 * the network hiccuped. `maybeSingle()` returns null only when there is genuinely
 * no row, and surfaces real errors.
 *
 * Returns `{ row, error }`; `row` is null when absent, `error` set on failure.
 */
export async function fetchProfileIdentityRow(userId) {
  if (!userId) return { row: null, error: null };
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id,email,first_name,last_name,share_code,join_date,account_status,native_language')
    .eq('id', userId)
    .maybeSingle();
  return { row: data ?? null, error: error ?? null };
}

export async function mintShareCodeMutation() {
  const { data, error } = await supabase.rpc('generate_share_code');
  return { data, error: error ?? null };
}

export async function syncUserMetaDataMutation(metaToUpdate, userId) {
  try {
    console.log('[syncUserMetaData] Updating profile metadata...', { userId, metaToUpdate });
    const dbData = toDbColumns(metaToUpdate);
    // Use upsert to handle both update and insert
    const { error } = await supabase.from('user_profiles').upsert({ id: userId, ...dbData }, { onConflict: 'id' });
    if (error) throw error;
    console.log(`🚀 syncUserMetaDataMutation: Profile ${userId} successfully upserted!`, metaToUpdate);
    console.log('[syncUserMetaData] Invalidating cache...');
    invalidateUserAndAuthCache();
  } catch (error) {
    console.error('🚨 Error syncing user meta data:', error);
    throw error;
  }
}

export async function signOut() {
  const result = await logout();
  invalidateUserAndAuthCache();
  return result;
}

// ── React Query hooks ──────────────────────────────────────────────

// "Am I signed in?" is a LOCAL question, so it must be answered locally.
//
// This used to call getCurrentUser(), which is `supabase.auth.getUser()` — a
// network round-trip to the auth server that returns null when it FAILS, which
// is indistinguishable from "there is no session". So any transient network or
// auth-server hiccup reported a signed-in visitor as signed out. That was
// reachable right after signup: the fire-and-forget geo/referrer collector
// finishes ~1s later and calls invalidateUserAndAuthCache(), which invalidates
// exactly this query, so the refetch races the first paint of the page the user
// was just redirected to.
//
// supabase.auth.getSession() reads the persisted session from storage and does
// not touch the network, so it cannot fail for reasons unrelated to auth state.
// Use getCurrentUser() where the server's view of the user is actually needed.
export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth', 'status'],
    queryFn: async () => {
      try {
        const session = await getCurrentSession();
        return session !== null;
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
            email: 'i@izs.me',
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
          const { data: row, error } = await supabase.from('user_profiles').select('*').eq('id', user.$id).single();
          if (error) throw error;
          const profileDoc = fromDbRow(row);
          const mergedData = {
            $id: user.$id,
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'supabase',
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
            auth_method: 'supabase',
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
  const queryClientHook = useQueryClient();
  return useMutation({
    mutationFn: async ({ metaToUpdate, userId }) => {
      const dbData = toDbColumns(metaToUpdate);
      const { error } = await supabase.from('user_profiles').upsert({ id: userId, ...dbData }, { onConflict: 'id' });
      if (error) throw error;
      console.log(`🚀 useSyncUserMetaData: Profile ${userId} successfully upserted!`, metaToUpdate);
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ['user', 'profile'] });
      queryClientHook.invalidateQueries({ queryKey: ['auth', 'status'] });
    },
    onError: (error) => {
      console.error('🚨 useSyncUserMetaData error:', error);
    }
  });
}

// Resolve a public profile by share code. Plain async function (not a hook) so
// non-React callers (the homepage share-code entry) can await it.
export async function fetchUserByShareCode(shareCode) {
  // Pilot hardening (003): anon column grant is restricted. Query the safe
  // view when unauthenticated, full table when logged-in. Fall back to the
  // legacy table if the view does not yet exist (pre-migration deploy).
  // friend_owners stays private: only the display counts are public.
  const SAFE_COLS = 'id,first_name,last_name,native_language,english_level,join_date,share_code,profile_picture_url,completed_dates,lessons_completed,counted_lessons,total_fluency_sum,recent_fluency_avgs,created_at,account_status,friend_links,friends,referrals';
  async function queryPublicProfiles() {
    const { data, error } = await supabase.from('public_profiles').select('*').eq('share_code', shareCode).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return fromDbRow(data[0]);
  }
  async function queryLegacy() {
    const { data, error } = await supabase.from('user_profiles').select(SAFE_COLS).eq('share_code', shareCode).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return fromDbRow(data[0]);
  }
  try {
    return await queryPublicProfiles();
  } catch {
    return await queryLegacy();
  }
}

export function useUserByShareCode(shareCode) {
  return useQuery({
    queryKey: ['user', 'profile', 'shareCode', shareCode],
    queryFn: () => fetchUserByShareCode(shareCode),
    enabled: !!shareCode,
  });
}

// Batch-resolves friend user-ids to their public rows for the Friends
// directory page. The `friends`/`friend_owners` credit arrays store user ids,
// not share codes, so the directory queries the safe public view by id.
// Fail-open: an empty input resolves to [] without a query, and a query
// failure resolves to [] so one outage hides the list instead of crashing it.
export async function fetchUsersByIds(ids) {
  const wanted = normalizeFriendIds(ids);
  if (wanted.length === 0) return [];
  try {
    const { data, error } = await supabase.from('public_profiles').select('*').in('id', wanted);
    if (error) throw error;
    console.log('[friends] fetched', data?.length ?? 0);
    return (data || []).map(fromDbRow);
  } catch (error) {
    console.error('[friends] fetchUsersByIds error:', error);
    return [];
  }
}

export function useFriendProfiles(ids) {
  const wanted = normalizeFriendIds(ids).sort();
  return useQuery({
    queryKey: ['user', 'profiles', 'byIds', wanted.join('|')],
    queryFn: () => fetchUsersByIds(wanted),
    enabled: wanted.length > 0,
    staleTime: Infinity,
  });
}

// Records a friend-challenge follow-up link in the owner's profile.
//
// Server-side RPC (migration 011). The client used to READ the whole
// `friend_links` map, merge one entry and write the map back with an UPDATE on
// `user_profiles`: a zero-row UPDATE is NOT an error in PostgREST, so the link
// could vanish SILENTLY — the profile then showed "all your lessons have
// expired" right after the learner recorded one, and the link they had sent to
// their friends was nowhere to be found. The RPC merges atomically on the
// server, derives the owner from auth.uid() (the client never has to know its
// own user id) and reports a failure as an error the caller can see.
export function useAddFriendLinkMutation() {
  const queryClientHook = useQueryClient();
  return useMutation({
    mutationFn: async ({ entry }) => {
      const { error } = await supabase.rpc('record_friend_link', {
        p_course_id: entry.courseId,
        p_recorded_lesson_id: entry.recordedLessonId,
        p_next_lesson_id: entry.lessonId,
        p_course_name: entry.courseName,
        p_lesson_title: entry.lessonTitle,
      });
      if (error) throw error;
      console.log('[friendLessonLink] saved', entry);
      return entry;
    },
    // The link is what the learner sends to their friends: one flaky round
    // trip must not lose it. The server merge is atomic and idempotent, so a
    // retry is safe (it refreshes the entry's addedAt, like a re-record).
    retry: 2,
    retryDelay: (attempt) => attempt * 1000,
    onSuccess: () => {
      // Prefix-matches both ['user','profile'] and ['user','profile','shareCode', code].
      queryClientHook.invalidateQueries({ queryKey: ['user', 'profile'] });
    },
    onError: (error) => {
      console.error('🚨 useAddFriendLinkMutation error:', error);
    },
  });
}

// ── Friend completions ─────────────────────────────────────────────
// Lesson-level joint completions the viewer recorded through `ownerId`'s share
// links. `counted_lessons` cannot answer this: it is per learner and per
// lesson, so it cannot say WHICH friend a lesson was done with — and a lesson
// is expected to be repeated with different friends. The ledger is written by
// record_friend_completion (one row per actor, owner, course and lesson), and
// RLS exposes only the caller's own rows; the explicit `.eq('actor_id', …)`
// keeps the query honest even if the policy ever widens. Disabled for a guest
// and for your own profile (a self-completion is never a joint one).
export async function fetchFriendCompletions({ viewerId, ownerId } = {}) {
  if (!viewerId || !ownerId || viewerId === ownerId) return [];
  const { data, error } = await supabase
    .from('friend_completions')
    .select('course_id,lesson_id')
    .eq('actor_id', viewerId)
    .eq('owner_id', ownerId);
  if (error) throw error;
  console.log('[friendCompletions] fetched', data?.length ?? 0);
  return (data || []).map((row) => ({ courseId: row.course_id, lessonId: row.lesson_id }));
}

export function useFriendCompletions(viewerId, ownerId) {
  return useQuery({
    queryKey: ['friend', 'completions', viewerId, ownerId],
    enabled: !!viewerId && !!ownerId && viewerId !== ownerId,
    // The public profile is a fresh mount right after finishing a lesson, and
    // the global default is staleTime: Infinity — a cached empty list would
    // hide the badge the learner just earned.
    staleTime: 0,
    queryFn: () => fetchFriendCompletions({ viewerId, ownerId }),
  });
}

// ── Notifications ──────────────────────────────────────────────────
// Friend-response inbox. Rows are created server-side by the
// record_friend_response RPC; the recipient reads and marks-read their own rows
// through RLS-scoped queries. No client-side provider SDK — a future delivery
// channel subscribes to inserts on the table (see story 019).
export function useNotifications(userId) {
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId && userId !== 'guest',
    // The bell is mounted once by the app shell, so this query lives for the
    // whole session: without a refresh rule a notification that arrives while
    // the app is open stays invisible until the page is reloaded. The policy
    // (re-read on mount, on focus, and every few seconds while the page is
    // visible) lives in the pure module so it can be unit-tested.
    ...resolveNotificationRefreshOptions(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id,type,course_id,lesson_id,payload,created_at,read_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      console.log('[notifications] fetched', data?.length ?? 0);
      return data || [];
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClientHook = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ids }) => {
      let query = supabase
        .from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', userId);
      query = ids && ids.length ? query.in('id', ids) : query.is('read_at', null);
      const { error } = await query;
      if (error) throw error;
      console.log('[notifications] marked read', ids?.length ?? 'all');
    },
    onSuccess: (_data, variables) => {
      queryClientHook.invalidateQueries({ queryKey: ['notifications', variables.userId] });
    },
    onError: (error) => {
      console.error('🚨 useMarkNotificationsRead error:', error);
    },
  });
}

export function useRecordFriendResponseMutation() {
  return useMutation({
    mutationFn: async ({ recipientShareCode, courseId, lessonId }) => {
      const { error } = await supabase.rpc('record_friend_response', {
        p_recipient_share_code: recipientShareCode,
        p_course_id: courseId,
        p_lesson_id: lessonId,
      });
      if (error) throw error;
      console.log('[notifications] friend response recorded for', recipientShareCode);
    },
    onError: (error) => {
      console.error('🚨 useRecordFriendResponseMutation error:', error);
    },
  });
}

// Credits a friend completion to the share-link owner: appends the completer
// to the owner's `friends`, appends the owner to the completer's
// `friend_owners`, and bumps `referrals` when it is the completer's first
// friend lesson ever. Server-side RPC (migration 007): RLS forbids writing
// another user's row, the actor is derived from auth.uid(), and the write is
// idempotent, so retries and double-fires are safe. Fail-open by contract —
// callers must never let a credit failure break the success flow.
export async function recordFriendCompletion({ ownerShareCode, courseId, lessonId } = {}) {
  if (!ownerShareCode) return { recorded: false, reason: 'no-owner' };
  try {
    const { error } = await supabase.rpc('record_friend_completion', {
      p_owner_share_code: ownerShareCode,
      p_course_id: courseId,
      p_lesson_id: lessonId,
    });
    if (error) throw error;
    console.log('[friendCredit] recorded completion for owner', ownerShareCode, courseId, lessonId);
    return { recorded: true };
  } catch (error) {
    console.error('🚨 recordFriendCompletion error:', error);
    return { recorded: false, reason: 'rpc-failed' };
  }
}

// Records a lesson completion on the caller's own profile row and returns the
// resulting counters.
//
// Server-side RPC (migration 012): the client used to add one to a baseline it
// read from a store copy, and write the whole thing back with an upsert — a
// write that can be lost SILENTLY (a zero-row upsert is not an error in
// PostgREST) and that is skipped entirely when the store has no profile copy
// yet. A learner who finished a lesson then saw their own public profile say
// they had completed nothing.
//
// The RPC keys on the session (auth.uid()), so it needs no user id, no client
// baseline and no store copy: the row's own values are the baseline, and the
// increment is atomic. It returns the resulting counters so the client can
// update its store without guessing.
//
// Fails loud but never breaks the lesson flow: a guest has no session, so the
// completion stays local until the signup credit applies it.
export async function recordLessonCompletion({ courseId, completedLessonId } = {}) {
  if (!courseId || !completedLessonId) return null;
  try {
    const { data, error } = await supabase.rpc('record_lesson_completion', {
      p_course_id: courseId,
      p_completed_lesson_id: completedLessonId,
    });
    if (error) throw error;
    if (!data) return null;
    console.log(`[Gamification] Lesson completed. Total lessons: ${data.lessons_completed}`);
    return {
      lessonsCompleted: Number(data.lessons_completed || 0),
      countedLessons: Array.isArray(data.counted_lessons) ? data.counted_lessons : [],
      completedDates: Array.isArray(data.completed_dates) ? data.completed_dates : [],
      isFirstCompletion: data.is_first_completion === true,
      dayAdded: data.day_added === true,
    };
  } catch (error) {
    console.error('🚨 recordLessonCompletion error:', error);
    return null;
  }
}

// AI functions moved to ai.js but keep re-export for compat
export { askEnglishTutor, evaluateWithAI } from './ai.js';
