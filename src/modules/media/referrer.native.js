/**
 * referrer.native.js
 * React Native referrer extraction.
 * Typical sources: initial deep link, navigation params.
 * Returns: string
 */
export function getReferrer() {
  // Example: read from a global that was set when the app was opened via a link
  // Replace with your actual linking logic.
  try {
    const deepLinkReferrer = global.__REFERRER__; // set in app entry point
    if (deepLinkReferrer) {
      console.log('[Referrer.native] Found referrer from deep link:', deepLinkReferrer);
      return deepLinkReferrer;
    }
    console.log('[Referrer.native] No referrer found.');
    return '';
  } catch (error) {
    console.warn('[Referrer.native] Error extracting referrer:', error);
    return '';
  }
}
