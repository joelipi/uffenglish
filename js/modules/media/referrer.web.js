/**
 * referrer.web.js
 * Web-only module — reads window.location.search + document.referrer.
 * React Native replaces this with referrer.native.js.
 *
 * Web‑specific referrer extraction from URL params or document.referrer.
 * Returns: string (empty string if none available)
 */
export function getReferrer() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref')?.trim();
    if (refParam) {
      console.log('[Referrer.web] Found ref param:', refParam);
      return refParam;
    }
    const referrerParam = urlParams.get('referrer')?.trim();
    if (referrerParam) {
      console.log('[Referrer.web] Found referrer param:', referrerParam);
      return referrerParam;
    }
    const docReferrer = document.referrer;
    if (docReferrer) {
      console.log('[Referrer.web] Found document.referrer:', docReferrer);
      return docReferrer;
    }
    console.log('[Referrer.web] No referrer found.');
    return '';
  } catch (error) {
    console.warn('[Referrer.web] Error extracting referrer:', error);
    return '';
  }
}
