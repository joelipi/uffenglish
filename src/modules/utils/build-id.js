// Which build is this page running?
//
// A preview deployment is only useful if the tester can tell it apart from the
// previous one. The service worker precaches the app shell, so an open client
// can keep serving an older build long after a deploy (stories/092: two rounds
// of fixes were invisible on the device for exactly this reason). The entry
// chunk's own hashed file name is the build id — it changes on every build and
// costs nothing to read.
//
// Pure: takes the module URL, returns a short label.

/**
 * @param {string} metaUrl the entry module's `import.meta.url`
 * @returns {string} the entry chunk's file name, or 'dev' on the Vite dev server
 */
export function resolveBuildId(metaUrl) {
    if (typeof metaUrl !== 'string' || !metaUrl) return 'unknown';
    let pathname = metaUrl;
    try {
        pathname = new URL(metaUrl, 'http://localhost').pathname;
    } catch (e) {
        // Not a URL (tests, odd environments) — fall through with the raw value.
    }
    const file = pathname.split('/').filter(Boolean).pop();
    if (!file) return 'unknown';
    // The dev server serves the source file, not a built chunk.
    if (file === 'main.jsx' || file.endsWith('.jsx') || file.endsWith('.tsx')) return 'dev';
    return file;
}

/** One-line boot marker so a tester can read the running build off the console. */
export function formatBuildLog(metaUrl) {
    return `[Build] ${resolveBuildId(metaUrl)}`;
}
