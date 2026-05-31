export function getIsDemoMode() {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
    if (window.location.search.includes('demo')) return true;
    if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('whisperMode') === 'demo') return true;
    return false;
}
