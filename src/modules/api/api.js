import { getCurrentUser, logout, supabase } from './supabase.js';
import { getGeoInfo } from '../media/geo-service.js';
import { upsertFriendLinkMap } from '../user/friend-lesson-link-logic.js';

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

export function useUserByShareCode(shareCode) {
  return useQuery({
    queryKey: ['user', 'profile', 'shareCode', shareCode],
    queryFn: async () => {
      // Pilot hardening (003): anon column grant is restricted. Query the safe
      // view when unauthenticated, full table when logged-in. Fall back to the
      // legacy table if the view does not yet exist (pre-migration deploy).
      const SAFE_COLS = 'id,first_name,last_name,native_language,english_level,join_date,share_code,profile_picture_url,completed_dates,lessons_completed,counted_lessons,total_fluency_sum,recent_fluency_avgs,created_at,account_status,friend_links';
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
    },
    enabled: !!shareCode,
  });
}

// Records a friend-challenge answer-lesson link in the owner's profile. Reads
// the current friend_links map, merges the new entry (one per course), and
// persists the whole map. Expiry is render-time only; nothing is deleted here.
export function useAddFriendLinkMutation() {
  const queryClientHook = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, entry }) => {
      const { data: row, error: readError } = await supabase
        .from('user_profiles').select('friend_links').eq('id', userId).single();
      if (readError) throw readError;
      const merged = upsertFriendLinkMap(row?.friend_links, entry);
      const { error } = await supabase
        .from('user_profiles').update({ friend_links: merged }).eq('id', userId);
      if (error) throw error;
      console.log('[friendLessonLink] saved', entry);
      return merged;
    },
    onSuccess: () => {
      // Prefix-matches both ['user','profile'] and ['user','profile','shareCode', code].
      queryClientHook.invalidateQueries({ queryKey: ['user', 'profile'] });
    },
    onError: (error) => {
      console.error('🚨 useAddFriendLinkMutation error:', error);
    },
  });
}

// AI functions moved to ai.js but keep re-export for compat
export { askEnglishTutor, evaluateWithAI } from './ai.js';
