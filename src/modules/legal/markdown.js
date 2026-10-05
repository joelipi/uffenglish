// src/modules/legal/markdown.js
// Pure markdown -> block/inline token parser for the static legal documents
// (docs/legal/*.md). Supports the exact subset those files use: HTML comments,
// h1-h3, thematic breaks, unordered lists, GFM tables, paragraphs, and inline
// bold / italic / code / links. No React, no DOM — rendering lives in
// components/legal (AGENTS.md logic/presentation split).

// Strip the maintainer-facing HTML comments at the top of each legal file so
// the "not legal advice" notice never renders on the public page.
export function stripHtmlComments(md) {
    return String(md ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

// The legal docs link to each other with sibling .md paths (which resolve on
// GitHub); inside the SPA those must become the router paths.
const HREF_MAP = {
    './privacy-policy.md': '/privacy',
    'privacy-policy.md': '/privacy',
    './terms-of-service.md': '/terms',
    'terms-of-service.md': '/terms',
};

export function legalHref(href) {
    return HREF_MAP[href] || href;
}

// One combined pattern, most-specific alternative first so `**bold**` is not
// mistaken for `*em*`. Runs until no match remains.
const INLINE_RE_SOURCE = String.raw`(\*\*[^*\n]+\*\*|\*[^*\n]+\*|` + '`[^`]+`' + String.raw`|\[[^\]]+\]\([^)\s]+\))`;

export function parseInline(text) {
    const src = String(text ?? '');
    const out = [];
    const re = new RegExp(INLINE_RE_SOURCE, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index) });
        const token = m[0];
        if (token.startsWith('**')) {
            out.push({ type: 'strong', value: token.slice(2, -2) });
        } else if (token.startsWith('`')) {
            out.push({ type: 'code', value: token.slice(1, -1) });
        } else if (token.startsWith('[')) {
            const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
            out.push({ type: 'link', value: link[1], href: legalHref(link[2]) });
        } else {
            out.push({ type: 'em', value: token.slice(1, -1) });
        }
        last = m.index + token.length;
    }
    if (last < src.length) out.push({ type: 'text', value: src.slice(last) });
    return out;
}

function parseCells(row) {
    let s = row.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
}

function isSeparatorRow(row) {
    const cells = parseCells(row);
    return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTable(rows) {
    const header = parseCells(rows[0]).map(parseInline);
    const rest = rows.slice(1);
    const body = rest.length && isSeparatorRow(rest[0]) ? rest.slice(1) : rest;
    return {
        type: 'table',
        header,
        rows: body.map((r) => parseCells(r).map(parseInline)),
    };
}

export function parseMarkdown(md) {
    const lines = stripHtmlComments(md).replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    const paragraph = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'paragraph', inlines: parseInline(text) });
        paragraph.length = 0;
    };

    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();

        if (!trimmed) {
            flushParagraph();
            i += 1;
            continue;
        }

        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading) {
            flushParagraph();
            blocks.push({ type: 'heading', level: heading[1].length, inlines: parseInline(heading[2].trim()) });
            i += 1;
            continue;
        }

        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flushParagraph();
            blocks.push({ type: 'hr' });
            i += 1;
            continue;
        }

        if (/^[-*+]\s+/.test(trimmed)) {
            flushParagraph();
            const items = [];
            while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
                items.push(parseInline(lines[i].trim().replace(/^[-*+]\s+/, '')));
                i += 1;
            }
            blocks.push({ type: 'list', items });
            continue;
        }

        if (trimmed.startsWith('|')) {
            flushParagraph();
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(lines[i].trim());
                i += 1;
            }
            blocks.push(parseTable(rows));
            continue;
        }

        paragraph.push(trimmed);
        i += 1;
    }

    flushParagraph();
    return blocks;
}
