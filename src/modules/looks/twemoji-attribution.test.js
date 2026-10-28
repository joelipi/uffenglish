// The Twemoji copyright notice lives in the index.html source comment, which is
// the kind of thing a future tidy-up deletes without noticing. Twemoji's README
// accepts "a mention in the HTML/JS source", so this guard keeps that mention
// present AND honest: the quoted acknowledgement wording, the copyright and
// license lines from the project, and the claim that the picker includes the
// ENTIRE collection — tied to the generated manifest and its pinned version so
// the numbers cannot drift.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TWEMOJI_EMOJIS } from '../../generated/twemoji-emojis.js';
import { TWEMOJI_CDN_BASE, TWEMOJI_VERSION } from './twemoji-collection.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

/** The leading source comment of index.html — the notice, not the whole file. */
export function readTwemojiNotice(source) {
    const start = source.indexOf('<!--');
    if (start === -1) return '';
    const end = source.indexOf('-->', start);
    if (end === -1) return '';
    const body = source.slice(start, end);
    // Only the notice block counts: a mention elsewhere is not this notice.
    return /Twemoji/.test(body) ? body : '';
}

const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const NOTICE = readTwemojiNotice(INDEX);

describe('index.html carries the official Twemoji acknowledgement', () => {
    it('finds the notice block in the source', () => {
        expect(NOTICE, 'no Twemoji notice comment in index.html').not.toBe('');
    });

    it('names the maintained library and its contributors', () => {
        expect(NOTICE).toContain('https://github.com/jdecked/twemoji');
        expect(NOTICE).toContain('Jason Sofonia');
        expect(NOTICE).toContain('Justine De Caires');
        expect(NOTICE).toContain('Copyright (c) 2014–2021 Twitter');
    });

    it('quotes the acknowledgment the project asks for', () => {
        // The sentence that makes the source mention sufficient — without it
        // the notice states facts but does not claim the acknowledgment.
        expect(NOTICE).toContain(
            'We would consider a\n       mention in the HTML/JS source sufficient also.'
        );
        expect(NOTICE).toContain('attribution is critical from a legal,');
    });

    it('carries the license lines and both license files', () => {
        expect(NOTICE).toContain('Code licensed under the MIT License: https://opensource.org/licenses/MIT');
        expect(NOTICE).toContain('Graphics licensed under CC-BY 4.0:');
        expect(NOTICE).toContain('https://creativecommons.org/licenses/by/4.0/');
        expect(NOTICE).toContain('LICENSE-GRAPHICS');
    });

    it('says the ENTIRE collection is included, matching the generated manifest', () => {
        expect(NOTICE).toMatch(/ENTIRE Twemoji artwork/);
        expect(TWEMOJI_EMOJIS.length).toBeGreaterThan(3000);
        // The quoted count must be the real one, so adding/regenerating the
        // collection fails here instead of leaving a stale number in the notice.
        const count = new Intl.NumberFormat('en-US').format(TWEMOJI_EMOJIS.length);
        expect(NOTICE).toContain(`${count} SVGs`);
    });

    it('pins the same version and CDN the picker loads', () => {
        expect(NOTICE).toContain(`Twemoji\n    ${TWEMOJI_VERSION},`);
        expect(NOTICE).toContain(`(${TWEMOJI_CDN_BASE}/)`);
    });

    it('indicates the modifications CC-BY 4.0 requires us to mark', () => {
        expect(NOTICE).toMatch(/MODIFICATIONS/);
        expect(NOTICE).toContain('TWEMOJI-ATTRIBUTION.md');
        expect(NOTICE).toMatch(/not endorsed/);
    });
});
