// Clipboard access for the on-screen diagnostics panel (stories/094).
//
// Web-only: the panel is a browser debugging aid, so this lives beside it and
// never reaches a native build. Returns whether the copy succeeded so the panel
// can label its button honestly.
export async function copyDiagnostics(text) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard
            && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(String(text ?? ''));
            return true;
        }
    } catch (error) {
        console.warn('[Diagnostics] clipboard write failed:', error && error.message ? error.message : error);
    }
    return false;
}
