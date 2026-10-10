// scripts/lib/bootstrap-homepage-css.js
// Pure CSS transformer: scope a full Bootstrap stylesheet under one root class so
// a single page can use real Bootstrap inside an app that ships its own,
// differently-scoped stylesheet (the public homepage). No I/O lives here; see
// bootstrap-homepage-plugin.js for the generator that writes the output file.
//
// Why scoping: the app stylesheet is a hand-written Bootstrap subset
// (src/assets/css/app.css defines .btn/.card/.form-select/... itself), so loading
// un-prefixed Bootstrap anywhere in the SPA would restyle every other route once
// the homepage had been visited. Every selector is rewritten under a root class so
// the rules only match inside that subtree.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// Root class the scoped Bootstrap rules live under. The homepage renders its
// outermost element with this class.
export const DEFAULT_SCOPE_CLASS = 'uff-home-bs';

// Prefix for renamed @keyframes. The original names collide with Bootstrap class
// names (.spinner-border), so the rename must be animation-scoped, not global.
export const DEFAULT_KEYFRAME_PREFIX = 'bs';

// Pinned Bootstrap version the homepage is allowed to use.
export const HOMEPAGE_BOOTSTRAP_VERSION = '5.3.8';

// Source stylesheet inside node_modules and the generated, committed output.
export const BOOTSTRAP_CSS_PATH = 'node_modules/bootstrap/dist/css/bootstrap.min.css';
export const HOMEPAGE_BOOTSTRAP_CSS_PATH = 'src/generated/homepage-bootstrap.css';

// Selectors that act as the document root inside the scope. They become the
// scope class itself instead of a descendant of it.
const ROOT_SELECTORS = new Set([':root', 'html', 'body']);

// html or body carrying nothing but pseudo-classes, classes, ids or attributes.
const ROOT_COMPOUND_RE = /^(?:html|body)(?::[a-z-]+(\([^)]*\))?|\.[-\w]+|\[[^\]]*\]|#[-\w]+)*$/;

/** Read the bundled Bootstrap stylesheet. */
export function readSourceBootstrapCss(root = process.cwd()) {
    return readFileSync(path.join(root, BOOTSTRAP_CSS_PATH), 'utf8');
}

/** Index just past the string literal that starts at `start`. */
function readString(css, start) {
    const quote = css[start];
    let i = start + 1;
    while (i < css.length) {
        if (css[i] === '\\') { i += 2; continue; }
        if (css[i] === quote) return i + 1;
        i += 1;
    }
    return css.length;
}

/** Index just past the block opened before `start`, plus its body text. */
function readBlock(css, start) {
    let depth = 1;
    let i = start;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") { i = readString(css, i); continue; }
        if (ch === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            i = close === -1 ? css.length : close + 2;
            continue;
        }
        if (ch === '{') { depth += 1; i += 1; continue; }
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) return { end: i + 1, body: css.slice(start, i) };
            i += 1;
            continue;
        }
        i += 1;
    }
    return { end: css.length, body: css.slice(start) };
}

/** Remove CSS comments, leaving comment markers inside strings untouched. */
export function stripComments(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            const end = readString(css, i);
            out += css.slice(i, end);
            i = end;
            continue;
        }
        if (ch === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            i = close === -1 ? css.length : close + 2;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

/**
 * Parse a stylesheet into statements. `prelude` is the text before `{` and `body`
 * the matching block text; `atStatement` marks the semicolon-terminated at-rules.
 */
export function parseStatements(css) {
    const statements = [];
    let buffer = '';
    let i = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            const end = readString(css, i);
            buffer += css.slice(i, end);
            i = end;
            continue;
        }
        if (ch === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            i = close === -1 ? css.length : close + 2;
            continue;
        }
        if (ch === '{') {
            const { end, body } = readBlock(css, i + 1);
            statements.push({ prelude: buffer.trim(), body });
            buffer = '';
            i = end;
            continue;
        }
        if (ch === ';') {
            const text = buffer.trim();
            if (text) statements.push({ prelude: text, atStatement: true });
            buffer = '';
            i += 1;
            continue;
        }
        buffer += ch;
        i += 1;
    }
    const trailing = buffer.trim();
    if (trailing) statements.push({ prelude: trailing, atStatement: true });
    return statements;
}

/** Split a selector list on top-level commas, keeping brackets and strings. */
export function splitSelectorList(prelude) {
    const parts = [];
    let buffer = '';
    let i = 0;
    while (i < prelude.length) {
        const ch = prelude[i];
        if (ch === '"' || ch === "'") {
            const end = readString(prelude, i);
            buffer += prelude.slice(i, end);
            i = end;
            continue;
        }
        if (ch === '(' || ch === '[') {
            const close = ch === '(' ? ')' : ']';
            let depth = 1;
            let j = i + 1;
            buffer += ch;
            while (j < prelude.length && depth > 0) {
                if (prelude[j] === '\\') { buffer += prelude.slice(j, j + 2); j += 2; continue; }
                if (prelude[j] === ch) depth += 1;
                if (prelude[j] === close) depth -= 1;
                buffer += prelude[j];
                j += 1;
            }
            i = j;
            continue;
        }
        if (ch === ',') { parts.push(buffer); buffer = ''; i += 1; continue; }
        buffer += ch;
        i += 1;
    }
    parts.push(buffer);
    return parts.map((s) => s.trim()).filter(Boolean);
}

/** Rewrite one selector so it only matches inside the scope subtree. */
export function scopeSelector(selector, scopeClass = DEFAULT_SCOPE_CLASS) {
    // A class selector, whatever form the caller passes in.
    const scoped = scopeClass.startsWith('.') ? scopeClass : `.${scopeClass}`;
    if (ROOT_SELECTORS.has(selector)) return scoped;
    if (ROOT_COMPOUND_RE.test(selector)) return scoped;
    // A descendant of the scope keeps Bootstrap's own specificity shape.
    return `${scoped} ${selector}`;
}

/** Scope every selector of a comma-separated list. */
export function scopeSelectorList(prelude, scopeClass = DEFAULT_SCOPE_CLASS) {
    return splitSelectorList(prelude).map((s) => scopeSelector(s, scopeClass)).join(', ');
}

const KEYFRAMES_RE = /^@(-webkit-|-moz-|-o-)?keyframes\s+([^\s{]+)$/;
const GROUP_AT_RULE_RE = /^@(media|supports|layer|container|scope)\b/;

/** Collect `{ originalName: scopedName }` for every keyframes block. */
export function collectKeyframeNames(css, prefix = DEFAULT_KEYFRAME_PREFIX) {
    const map = new Map();
    for (const statement of parseStatements(css)) {
        const match = statement.prelude.match(KEYFRAMES_RE);
        if (match) map.set(match[2], `${prefix}-${match[2]}`);
    }
    return map;
}

/**
 * Rename the scoped keyframes inside animation declarations and inside the
 * custom properties Bootstrap uses to reference them (5.3.8 writes
 * `animation: var(--bs-spinner-animation-speed) linear infinite
 * var(--bs-spinner-animation-name)`), so class selectors that share the
 * keyframe names (.spinner-border) are never touched.
 */
export function renameAnimationNames(css, keyframeMap) {
    if (!keyframeMap || keyframeMap.size === 0) return css;
    const replaceInValue = (value) => value
        .split(/(\s+)/)
        .map((token) => (keyframeMap.has(token) ? keyframeMap.get(token) : token))
        .join('');
    const withAnimations = css.replace(
        /(^|[;{])(\s*)(-webkit-|-moz-|-o-)?animation(-name)?(\s*):([^;}]+)/g,
        (_match, lead, ws1, vendor, namePart, ws2, value) =>
            `${lead}${ws1}${vendor || ''}animation${namePart || ''}${ws2}:${replaceInValue(value)}`,
    );
    return withAnimations.replace(
        /(--[a-zA-Z0-9-]+)(\s*:\s*)([^;}]+)/g,
        (match, name, colon, value) => {
            const trimmed = value.trim();
            return keyframeMap.has(trimmed) ? `${name}${colon}${keyframeMap.get(trimmed)}` : match;
        },
    );
}

function scopeStatement(statement, options, keyframeMap) {
    const { scopeClass, prefix } = options;
    const { prelude } = statement;

    // @charset and friends are meaningless inside a scoped stylesheet.
    if (statement.atStatement) return '';

    const keyframes = prelude.match(KEYFRAMES_RE);
    if (keyframes) {
        const scopedName = keyframeMap.get(keyframes[2]) || `${prefix}-${keyframes[2]}`;
        return `@${keyframes[1] || ''}keyframes ${scopedName}{${statement.body}}`;
    }

    // Conditional group rules: recurse, keep the prelude verbatim.
    if (GROUP_AT_RULE_RE.test(prelude)) {
        return `${prelude}{${scopeBlockBody(statement.body, options, keyframeMap)}}`;
    }

    return `${scopeSelectorList(prelude, scopeClass)}{${statement.body}}`;
}

function scopeBlockBody(css, options, keyframeMap) {
    return parseStatements(css)
        .map((statement) => scopeStatement(statement, options, keyframeMap))
        .join('');
}

/**
 * Scope a complete Bootstrap stylesheet under one root class. Deterministic: the
 * same input always yields the same output.
 */
export function scopeBootstrapCss(css, options = {}) {
    const scopeClass = options.scopeClass || DEFAULT_SCOPE_CLASS;
    const prefix = options.prefix || DEFAULT_KEYFRAME_PREFIX;
    const source = stripComments(css);
    const keyframeMap = collectKeyframeNames(source, prefix);
    const scoped = scopeBlockBody(source, { scopeClass, prefix }, keyframeMap);
    return `${renameAnimationNames(scoped, keyframeMap).trim()}\n`;
}

/**
 * Every qualified-rule selector of a stylesheet, with group at-rules unwrapped.
 * The tests use it to assert that no selector escapes the scope.
 */
export function flattenedSelectors(css) {
    const flat = [];
    const walk = (input) => {
        for (const statement of parseStatements(stripComments(input))) {
            if (statement.atStatement) continue;
            if (KEYFRAMES_RE.test(statement.prelude)) continue;
            if (GROUP_AT_RULE_RE.test(statement.prelude)) { walk(statement.body); continue; }
            flat.push(statement.prelude);
        }
    };
    walk(css);
    return flat;
}

/** `true` when every selector of every qualified rule carries the scope class. */
export function isFullyScoped(css, scopeClass = DEFAULT_SCOPE_CLASS) {
    const scoped = scopeClass.startsWith('.') ? scopeClass : `.${scopeClass}`;
    return flattenedSelectors(css).every((prelude) =>
        splitSelectorList(prelude).every((selector) =>
            selector === scoped || selector.startsWith(`${scoped} `)));
}
