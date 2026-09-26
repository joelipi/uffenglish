// modules/user/guest-modal-logic.js
// Pure decision logic for the guest login/language modal. Keeps the modal
// behaviour deterministic and testable without React, the store, or the DOM.

export const ENGLISH_LANG = 'EN';

// - friend lesson + non-English browser -> adopt the browser language silently
//   (no modal at all)
// - friend lesson + English browser     -> language step only
// - non-friend lesson                   -> the existing two-step flow
export function resolveGuestModalPlan({ isFriendLesson, detectedLang } = {}) {
    const lang = (typeof detectedLang === 'string' && detectedLang) ? detectedLang : ENGLISH_LANG;
    if (isFriendLesson && lang !== ENGLISH_LANG) {
        return { action: 'adopt-silently', language: lang };
    }
    return { action: 'open-language', friendMode: !!isFriendLesson };
}
