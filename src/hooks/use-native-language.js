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
 * The returned code keeps the store's casing (`'ES'`, region tags preserved):
 * pass it through `Strings.get`/`getBilingual`/`normalizeLanguageCode` (which
 * all normalize internally) rather than keying a locale map with it directly.
 *
 * @param {string|null|undefined} [fallbackLang] - an optional fresher profile
 *   record (e.g. a just-refetched query that the store mirror has not caught
 *   up with yet). Used only when no guest choice exists, ahead of the store
 *   mirror: `guest || fallback || store.userData || 'en'`.
 * @returns {string} a language code (e.g. 'BN' or 'bn'), defaulting to 'en'
 */
export function useNativeLanguage(fallbackLang) {
    const guestLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const profileLang = useStore(appStore, (state) => state.userData?.native_language);
    return resolveConfigLanguage(guestLang, fallbackLang || profileLang);
}
