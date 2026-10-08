import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';
import { resolveConfigLanguage } from '../modules/bilingual/config-normalizer.js';

/**
 * The active UI/lesson language, resolved guest-first.
 *
 * `guestNativeLanguage` is authoritative and `userData.native_language` is its
 * mirror (AGENTS.md). The async profile bootstrap can write the fetched
 * profile's `native_language` ("EN") after a guest picked Bengali, so a
 * component that reads `userData.native_language` directly can render English
 * while the rest of the app is in the chosen language. Always localize with this
 * hook (or the same `guestNativeLanguage || userData?.native_language || 'en'`
 * expression) rather than reading `userData.native_language` alone.
 *
 * @returns {string} a language code (e.g. 'BN' or 'bn'), defaulting to 'en'
 */
export function useNativeLanguage() {
    const guestLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const profileLang = useStore(appStore, (state) => state.userData?.native_language);
    return resolveConfigLanguage(guestLang, profileLang);
}
