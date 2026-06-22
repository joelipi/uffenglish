// @web-only
// Intentional window access — guarded by typeof window === 'undefined' check.
// In React Native window is undefined → returns false (PWA mode off).
// In web, reads URL search params + localStorage for PWA/whisper mode flags.
export function getIsPWAMode() {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('pwa')) return true;
    if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('whisperMode') === 'pwa') return true;
    return false;
}