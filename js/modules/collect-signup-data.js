/**
 * collect-signup-data.js
 * Core signup geo/referrer collection shared between web and React Native.
 * Uses platform‑specific getGeoInfo & getReferrer (resolved by bundler).
 */
import { fetchGeoInfo, getCurrentUser, syncUserMetaDataMutation } from './api.js';
import { getReferrer }      from './referrer.js';           // resolves to .web or .native

/**
 * Collects IP geolocation and referrer, syncs to Appwrite if authenticated.
 * Silently fails if any step fails.
 */
export async function collectSignupGeoAndReferrer() {
  try {
    console.log('[CollectSignup] Starting silent geo & referrer collection...');
    const geo     = await fetchGeoInfo();
    const ref     = getReferrer();
    console.log('[CollectSignup] Raw data:', { geo, ref });

    // Build metadata only with non‑empty values
    const meta = {};
    if (geo.ip)      meta.signup_ip = geo.ip;
    if (geo.country) meta.country   = geo.country;
    if (geo.region)  meta.region    = geo.region;
    if (geo.city)    meta.city      = geo.city;
    if (ref)         meta.referrer  = ref;

    if (Object.keys(meta).length === 0) {
      console.log('[CollectSignup] No data collected, skipping.');
      return;
    }

    // Sync to Appwrite if user is logged in
    const currentUser = await getCurrentUser();
    if (currentUser && currentUser.$id) {
      try {
        await syncUserMetaDataMutation(meta, currentUser.$id);
        console.log('[CollectSignup] Data synced to Appwrite successfully.');
      } catch (syncError) {
        console.error('[CollectSignup] Failed to sync to Appwrite:', syncError);
      }
    } else {
      console.log('[CollectSignup] User not authenticated, skipping server sync.');
    }
  } catch (error) {
    // Non‑blocking: log and continue
    console.error('[CollectSignup] Unexpected error during collection:', error);
  }
}
