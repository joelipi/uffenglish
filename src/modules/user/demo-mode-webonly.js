// @web-only
// Intentional window access — guarded by typeof window === 'undefined' check.
// In React Native window is undefined → returns false (demo mode off).
// In web, reads URL search params + localStorage for demo/whisper mode flags.
export function getIsDemoMode() {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('demo')) return true;
    if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('whisperMode') === 'demo') return true;
    return false;
}