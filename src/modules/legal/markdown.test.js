import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, legalHref, stripHtmlComments } from './markdown.js';
import privacyDoc from '../../../docs/legal/privacy-policy.md?raw';
import termsDoc from '../../../docs/legal/terms-of-service.md?raw';

describe('stripHtmlComments', () => {
    it('removes the maintainer notice so it never renders', () => {
        const out = stripHtmlComments('<!-- hidden -->\n# Visible');
        expect(out).not.toContain('hidden');
        expect(out).toContain('# Visible');
    });

    it('removes multi-line comments', () => {
        expect(stripHtmlComments('a\n<!--\nline1\nline2\n-->\nb')).toBe('a\n\nb');
    });
});

describe('legalHref', () => {
    it('rewrites sibling .md links to SPA routes', () => {
        expect(legalHref('./privacy-policy.md')).toBe('/privacy');
        expect(legalHref('./terms-of-service.md')).toBe('/terms');
    });

    it('leaves external and unknown links untouched', () => {
        expect(legalHref('https://example.com')).toBe('https://example.com');
        expect(legalHref('/home')).toBe('/home');
    });
});

describe('parseInline', () => {
    it('parses bold, italic, code and links in order', () => {
        const tokens = parseInline('a **b** *c* `d` [e](./terms-of-service.md)');
        expect(tokens.map((t) => t.type)).toEqual(['text', 'strong', 'text', 'em', 'text', 'code', 'text', 'link']);
        expect(tokens[1].value).toBe('b');
        expect(tokens[3].value).toBe('c');
        expect(tokens[5].value).toBe('d');
        expect(tokens[7]).toMatchObject({ value: 'e', href: '/terms' });
    });

    it('does not mistake bold for italic', () => {
        const tokens = parseInline('**bold**');
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ type: 'strong', value: 'bold' });
    });

    it('returns plain text as a single token', () => {
        expect(parseInline('just words')).toEqual([{ type: 'text', value: 'just words' }]);
    });
});

describe('parseMarkdown blocks', () => {
    it('parses headings by level', () => {
        const blocks = parseMarkdown('# One\n## Two\n### Three');
        expect(blocks.map((b) => b.level)).toEqual([1, 2, 3]);
        expect(blocks[0].type).toBe('heading');
    });

    it('joins wrapped paragraph lines into one paragraph', () => {
        const blocks = parseMarkdown('line one\nline two\n\nnext');
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ type: 'paragraph' });
        expect(blocks[0].inlines[0].value).toBe('line one line two');
    });

    it('parses a thematic break', () => {
        expect(parseMarkdown('a\n\n---\n\nb').map((b) => b.type)).toEqual(['paragraph', 'hr', 'paragraph']);
    });

    it('parses an unordered list', () => {
        const blocks = parseMarkdown('- one\n- two\n- three');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('list');
        expect(blocks[0].items).toHaveLength(3);
    });

    it('parses a table with a header and separator row', () => {
        const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
        expect(blocks).toHaveLength(1);
        const table = blocks[0];
        expect(table.type).toBe('table');
        expect(table.header.map((c) => c[0].value)).toEqual(['A', 'B']);
        expect(table.rows).toHaveLength(2);
        expect(table.rows[1].map((c) => c[0].value)).toEqual(['3', '4']);
    });

    it('parses inline formatting inside list items and table cells', () => {
        const list = parseMarkdown('- **bold** item')[0];
        expect(list.items[0][0]).toMatchObject({ type: 'strong', value: 'bold' });
        const table = parseMarkdown('| H |\n|---|\n| `x` |')[0];
        expect(table.rows[0][0][0]).toMatchObject({ type: 'code', value: 'x' });
    });
});

describe('the real legal documents parse cleanly', () => {
    for (const [name, doc] of [['privacy', privacyDoc], ['terms', termsDoc]]) {
        it(`${name}: strips the draft comment`, () => {
            expect(doc).toContain('NOT LEGAL ADVICE');
            const rendered = stripHtmlComments(doc);
            expect(rendered).not.toContain('NOT LEGAL ADVICE');
        });

        it(`${name}: starts with an H1 and has no unparsed markdown markers`, () => {
            const blocks = parseMarkdown(doc);
            expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });

            const flatText = blocks
                .flatMap((b) => {
                    if (b.type === 'heading' || b.type === 'paragraph') return b.inlines;
                    if (b.type === 'list') return b.items.flat();
                    if (b.type === 'table') return [...b.header, ...b.rows.flat()].flat();
                    return [];
                })
                .map((t) => t.value ?? '')
                .join(' ');
            expect(flatText).not.toContain('**');
            expect(flatText).not.toContain('](');
            expect(flatText).not.toContain('|---');
        });

        it(`${name}: drops the table separator row when present`, () => {
            const tables = parseMarkdown(doc).filter((b) => b.type === 'table');
            if (name !== 'privacy') {
                expect(tables).toHaveLength(0);
                return;
            }
            expect(tables.length).toBeGreaterThan(0);
            for (const table of tables) {
                const values = [...table.header.flat(), ...table.rows.flat().flat()].map((c) => c.value ?? '');
                expect(values.some((v) => /^-{3,}$/.test(v.trim()))).toBe(false);
            }
        });
    }

    it('terms doc cross-links to the privacy route', () => {
        const links = parseMarkdown(termsDoc)
            .flatMap((b) => (b.type === 'paragraph' || b.type === 'heading' ? b.inlines : []))
            .filter((t) => t.type === 'link')
            .map((t) => t.href);
        expect(links).toContain('/privacy');
    });
});
