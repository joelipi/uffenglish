// modules/auth-check.js
// Lightweight fetch-based auth check — no Appwrite SDK import.
// Works because Appwrite sessions are cookie-based; credentials: 'include'
// sends the a_session_* cookie automatically.
// The full Appwrite SDK is only needed for mutations (login, signup, profile edits).

import defaultProfilePic from '../../assets/img/userprofile.png';

const ENDPOINT = 'https://nyc.cloud.appwrite.io/v1';
const PROJECT_ID = '69e6faf4001ff72b2ac3';
const DATABASE_ID = '69e6fc160026cb28cf02';
const USER_PROFILES_TABLE_ID = 'userprofilestable';

const _headers = {
  'X-Appwrite-Project': PROJECT_ID,
  'X-Appwrite-Response-Format': '1.6.0',
};

/**
 * Check if the user has an active session.
 * @returns {{ isLoggedIn: boolean, user: object|null }}
 *   user contains at minimum { $id, email, name, $createdAt } when logged in.
 */
export async function checkAuth() {
  try {
    const res = await fetch(`${ENDPOINT}/account`, {
      credentials: 'include',
      headers: _headers,
    });
    if (!res.ok) return { isLoggedIn: false, user: null };
    const user = await res.json();
    return { isLoggedIn: true, user };
  } catch (err) {
    console.warn('[auth-check] checkAuth network error:', err);
    return { isLoggedIn: false, user: null };
  }
}

/**
 * Fetch the full user profile (account data + TablesDB extended profile).
 * For guests, returns a synthetic guest profile immediately.
 * @param {object|null} user - The account object from checkAuth(), or null for guest
 * @returns {object} User profile object
 */
export async function getUserProfile(user) {
  // Guest path — no network call
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
      profilepicurl: defaultProfilePic,
    };
    console.log('[auth-check] Guest profile:', guestData);
    return guestData;
  }

  // Logged-in user — fetch extended profile from TablesDB
  try {
    const rowUrl = `${ENDPOINT}/databases/${DATABASE_ID}/tables/${USER_PROFILES_TABLE_ID}/rows/${user.$id}`;
    const res = await fetch(rowUrl, {
      credentials: 'include',
      headers: _headers,
    });

    if (!res.ok) {
      // 404 means the profile row hasn't been created yet — return account data as-is
      if (res.status === 404) {
        console.warn('[auth-check] Profile row not found, returning core user data');
        return {
          $id: user.$id,
          email: user.email,
          display_name: user.name,
          join_date: user.$createdAt,
          auth_method: 'appwrite',
          profilepicurl: defaultProfilePic,
        };
      }
      throw new Error(`Profile fetch failed: ${res.status}`);
    }

    const profileDoc = await res.json();
    const mergedData = {
      $id: user.$id,
      email: user.email,
      display_name: user.name,
      join_date: user.$createdAt,
      auth_method: 'appwrite',
      ...profileDoc,
      profilepicurl: profileDoc?.profilepicurl || defaultProfilePic,
    };
    console.log('[auth-check] Merged profile:', mergedData);
    return mergedData;
  } catch (err) {
    console.error('[auth-check] getUserProfile error:', err);
    // Fallback to basic account data on any error
    return {
      $id: user.$id,
      email: user.email,
      display_name: user.name,
      join_date: user.$createdAt,
      auth_method: 'appwrite',
      profilepicurl: defaultProfilePic,
    };
  }
}
