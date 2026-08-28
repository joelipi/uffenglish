// modules/auth-check.js — Supabase version (no Appwrite SDK)
import defaultProfilePic from '../../assets/img/userprofile.png';
import { supabase, getCurrentUser } from './supabase.js';

export async function checkAuth() {
  try {
    const user = await getCurrentUser();
    if (!user) return { isLoggedIn: false, user: null };
    return { isLoggedIn: true, user };
  } catch (err) {
    console.warn('[auth-check] checkAuth error:', err);
    return { isLoggedIn: false, user: null };
  }
}

export async function getUserProfile(user) {
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
      profilePictureUrl: defaultProfilePic,
    };
    console.log('[auth-check] Guest profile:', guestData);
    return guestData;
  }

  try {
    const { data: row, error } = await supabase.from('user_profiles').select('*').eq('id', user.$id).single();
    if (error) {
      if (error.code === 'PGRST116') {
        console.warn('[auth-check] Profile row not found, returning core user data');
        return {
          $id: user.$id,
          email: user.email,
          display_name: user.name,
          join_date: user.$createdAt,
          auth_method: 'supabase',
          profilePictureUrl: defaultProfilePic,
        };
      }
      throw error;
    }
    const mergedData = {
      $id: user.$id,
      email: user.email,
      display_name: user.name,
      join_date: user.$createdAt,
      auth_method: 'supabase',
      ...row,
      // Map snake_case back
      profilePictureUrl: row.profile_picture_url || defaultProfilePic,
      shareCode: row.share_code,
      friendCode: row.friend_code,
      firstName: row.first_name,
      lastName: row.last_name,
    };
    console.log('[auth-check] Merged profile:', mergedData);
    return mergedData;
  } catch (err) {
    console.error('[auth-check] getUserProfile error:', err);
    return {
      $id: user.$id,
      email: user.email,
      display_name: user.name,
      join_date: user.$createdAt,
      auth_method: 'supabase',
      profilePictureUrl: defaultProfilePic,
    };
  }
}
