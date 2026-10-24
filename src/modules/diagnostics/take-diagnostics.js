// A tiny in-memory log of the recording/playback diagnostics.
//
// The iPad bugs (stories/094) are diagnosed from log lines, and copying a console
// out of eruda on an iPad is impractical. This module is the transport for a
// test-only on-screen panel (`?diag=1`): the same payloads that go to the console
// are pushed here, formatted as one line each, and rendered so a screenshot (or
// the copy button) carries them off the device.
//
// NO React, NO DOM: the log is a plain observable list, and the formatting rules
// are pure so they can be tested in jsdom.

/** How many entries the on-screen panel keeps (oldest dropped first). */
export const TAKE_DIAGNOSTICS_LIMIT = 14;

/** Longest JSON payload rendered on one line (a screenshot must stay readable). */
export const TAKE_DIAGNOSTIC_PAYLOAD_MAX = 320;

function safeJson(value) {
    if (value === undefined) return '';
    try {
        const json = JSON.stringify(value);
        if (json === undefined) return String(value);
        if (json.length <= TAKE_DIAGNOSTIC_PAYLOAD_MAX) return json;
        return `${json.slice(0, TAKE_DIAGNOSTIC_PAYLOAD_MAX - 1)}…`;
    } catch (error) {
        return String(value);
    }
}

/**
 * One diagnostic as a single line: the label, then its JSON payload.
 *
 * @param {{label?: string, payload?: any, atMs?: number}|null|undefined} entry
 * @returns {string}
 */
export function formatDiagnosticEntry(entry) {
    if (!entry) return '';
    const label = typeof entry.label === 'string' ? entry.label : '';
    const payload = safeJson(entry.payload);
    return payload ? `${label} ${payload}` : label;
}

/**
 * The log the app pushes to. Bounded (the panel cannot grow without limit) and
 * observable (the panel re-renders on each push).
 *
 * @param {{ limit?: number, now?: () => number }} [options]
 */
export function createDiagnosticsLog({ limit = TAKE_DIAGNOSTICS_LIMIT, now = () => Date.now() } = {}) {
    let entries = [];
    const listeners = new Set();

    const emit = () => {
        listeners.forEach((listener) => {
            try {
                listener(entries);
            } catch (error) {
                console.warn('[Diagnostics] listener failed:', error && error.message ? error.message : error);
            }
        });
    };

    return {
        /**
         * @param {string} label short, greppable name (e.g. `capture take 2`)
         * @param {any} [payload] anything JSON-able
         */
        push(label, payload) {
            const entry = { label: String(label || ''), payload, atMs: now() };
            entries = [...entries, entry].slice(-Math.max(1, limit));
            emit();
            return entry;
        },
        entries() {
            return entries;
        },
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        clear() {
            entries = [];
            emit();
        },
        limit,
    };
}

/** The process-wide log the app writes to and the panel reads. */
export const takeDiagnostics = createDiagnosticsLog();

/**
 * Whether the URL asks for the on-screen panel (`?diag=1`, or `diag=true`).
 *
 * @param {string} [search] a location search string, with or without the `?`
 * @returns {boolean}
 */
export function shouldShowDiagnostics(search) {
    if (typeof search !== 'string' || search === '') return false;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const value = params.get('diag');
    return value === '1' || value === 'true';
}

/**
 * The whole log as text, for the copy button.
 *
 * @param {Array<{label: string, payload?: any}>} entries
 * @returns {string}
 */
export function formatDiagnosticsText(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 'no diagnostics yet';
    return entries.map(formatDiagnosticEntry).join('\n');
}
