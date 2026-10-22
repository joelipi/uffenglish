/**
 * Throwaway on-device diagnostic panel + reporter.
 *
 * The field failure (every voice take captures digital silence on iPadOS 27) is
 * being diagnosed on a real iPad, where opening a console and copy/pasting log
 * text is impractical. This module
 *   1. puts the handful of numbers that matter straight on the screen, and
 *   2. posts them to a write-only `field_diag` table in the project's Supabase
 *      instance (insert-only policy for `anon`, no read access), so the
 *      investigator can read the result without the learner copying anything.
 *
 * No identifiers are sent: no deviceId, no groupId, no user id — only the label,
 * the value, the user agent and the page path.
 *
 * Not for production: remove along with the `[TAP]` / `[TAP-PROBE]` /
 * `inspectRecordedClipAudio` instrumentation.
 */

const SUPABASE_URL = 'https://jbrbmbmupjfangqvaevx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xd9bYag0bVG7m74CemthjQ_sJEbQG9S';

let panel = null;
let pending = {};
let flushTimer = null;

function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'field-diag';
    panel.setAttribute('data-testid', 'field-diag');
    panel.style.cssText = [
        'position: fixed',
        'left: 0',
        'right: 0',
        'top: env(safe-area-inset-top, 0px)',
        'z-index: 2147483647',
        'background: rgba(6, 14, 26, 0.92)',
        'color: #9fe6ff',
        'font: 600 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        'padding: 8px 12px',
        'white-space: pre-wrap',
        'word-break: break-word',
        'border-bottom: 2px solid #2f6df6',
        'pointer-events: none',
        'max-height: 46vh',
        'overflow: hidden',
    ].join(';');
    document.body.appendChild(panel);
    return panel;
}

function flush(source) {
    const payload = { ...pending, ua: navigator.userAgent, path: location.pathname, at: new Date().toISOString() };
    pending = {};
    try {
        fetch(`${SUPABASE_URL}/rest/v1/field_diag`, {
            method: 'POST',
            keepalive: true,
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ source, payload }),
        }).catch(() => {});
    } catch (e) {
        /* reporting must never affect the lesson */
    }
}

/** Show (or replace) one labelled value, and report it in a batch. */
export function fieldDiag(label, value, source = 'app') {
    try {
        const el = ensurePanel();
        const key = String(label).toUpperCase();
        const line = `${key}: ${value}`;
        const kept = (el.textContent || '')
            .split('\n')
            .filter((l) => l && !l.startsWith(`${key}:`));
        kept.push(line);
        el.textContent = kept.slice(-6).join('\n');
        console.log('[DIAG]', line);

        pending[key.toLowerCase()] = String(value);
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => flush(source), 2500);
    } catch (e) {
        /* never let a diagnostic break the lesson */
    }
}

/** Hide the panel (e.g. once the take produced a transcript). */
export function fieldDiagHide() {
    try {
        if (panel) panel.remove();
        panel = null;
    } catch (e) {
        /* ignore */
    }
}
