// modules/user/html-escape.js
// Escape a value for interpolation into an HTML attribute or text node. Shared
// by the transactional email builders (welcome + auth).
export function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
