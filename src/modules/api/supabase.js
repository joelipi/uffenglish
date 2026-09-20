// modules/supabase.js — Supabase client singleton (replaces appwrite.js)
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from './supabase-constants.js';

export const SUPABASE_CONFIG = {
  URL: import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
};

// Keep APPWRITE_CONFIG as deprecated alias so any missed import doesn't crash
export const APPWRITE_CONFIG = {
  ENDPOINT: SUPABASE_CONFIG.URL,
  PROJECT_ID: 'supabase',
  DATABASE_ID: 'public',
  USER_PROFILES_TABLE_ID: 'user_profiles',
  AVATAR_BUCKET_ID: 'avatars',
};

export const supabase = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Map Supabase user -> Appwrite-shaped user for minimal consumer churn
function mapSupabaseUser(u) {
  if (!u) return null;
  return {
    $id: u.id,
    $createdAt: u.created_at,
    email: u.email,
    name: u.user_metadata?.full_name || u.user_metadata?.fullName || u.email?.split('@')[0] || '',
    ...u,
    id: u.id,
  };
}

export async function getCurrentUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return mapSupabaseUser(user);
  } catch {
    return null;
  }
}

export async function getCurrentSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch {
    return null;
  }
}

export async function getAccessToken() {
  const session = await getCurrentSession();
  return session?.access_token || null;
}

export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Logout error:', error);
    return false;
  }
}

// Deprecated re-exports for compat shims (so old imports don't break during migration)
export const account = {
  get: async () => {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    return user;
  },
  create: async () => { throw new Error('Use supabase.auth.signUp'); },
  createEmailPasswordSession: async () => { throw new Error('Use supabase.auth.signInWithPassword'); },
  deleteSession: async () => logout(),
  createRecovery: async () => { throw new Error('Use supabase.auth.resetPasswordForEmail'); },
  updateRecovery: async () => { throw new Error('Use supabase.auth.updateUser'); },
  updateName: async (name) => {
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (error) throw error;
  },
  updateEmail: async (email, _password) => {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw error;
  },
  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },
  createJWT: async () => {
    const token = await getAccessToken();
    return { jwt: token || '' };
  },
};
