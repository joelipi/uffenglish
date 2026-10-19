// Guard: auth navigation links (signup / login / forgot-password /
// back-to-login) render on dark-blue surfaces (the AuthLayout card and the
// bg-dark modals), where the default browser link blue is unreadable. Every
// such link must carry the `auth-link` class (bold white), and the stylesheet
// must define that class as bold white — not the default blue.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODALS_DIR = path.join(HERE, '..', 'modals');
const CSS_PATH = path.join(HERE, '..', '..', 'assets', 'css', 'app.css');

const read = (p) => readFileSync(p, 'utf8');
const css = read(CSS_PATH);

// Scope to a single rule block so the guard can fail: a whole-file
// `toContain` stays green even when the rule is deleted.
const blockFor = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) return '';
    return css.slice(start, css.indexOf('}', start) + 1);
};
const baseBlock = blockFor('.auth-link');
const hoverBlock = blockFor('.auth-link:hover, .auth-link:focus-visible');

// Opening `<a …>` tags cannot be matched with `/<a\b[^>]*>/`: the first `>`
// is the arrow in `onClick={(e) => …}`, so that regex truncates the tag
// before `className` whenever attributes are reordered. This scanner walks
// past `{…}` JSX expressions and quoted strings to the real tag end.
const anchorTags = (src) => {
    const tags = [];
    let i = 0;
    while (true) {
        const start = src.indexOf('<a', i);
        if (start === -1) return tags;
        const next = src[start + 2];
        if (next !== ' ' && next !== '\n' && next !== '\t' && next !== '>') {
            i = start + 2;
            continue;
        }
        let j = start + 2;
        let depth = 0;
        let quote = null;
        while (j < src.length) {
            const ch = src[j];
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '{') {
                depth += 1;
            } else if (ch === '}') {
                depth -= 1;
            } else if (ch === '>' && depth === 0) {
                break;
            }
            j += 1;
        }
        tags.push(src.slice(start, j + 1));
        i = j + 1;
    }
};

const CASES = [
    ['LoginForm.web.jsx', path.join(HERE, 'LoginForm.web.jsx'), ['auth_sign_up_link', 'auth_forgot_password']],
    ['SignupForm.web.jsx', path.join(HERE, 'SignupForm.web.jsx'), ['auth_log_in_link']],
    ['RecoverPasswordForm.web.jsx', path.join(HERE, 'RecoverPasswordForm.web.jsx'), ['auth_back_to_login']],
    ['SaveClipsSignupForm.jsx', path.join(MODALS_DIR, 'SaveClipsSignupForm.jsx'), ['saveClipsLoginLink']],
];

describe('auth navigation links use the high-contrast auth-link style', () => {
    it('defines the .auth-link rules (guards against a renamed selector)', () => {
        expect(baseBlock).not.toBe('');
        expect(hoverBlock).not.toBe('');
    });

    it('styles .auth-link bold white with an underline', () => {
        expect(baseBlock).toMatch(/color:\s*#ffffff/);
        expect(baseBlock).toMatch(/font-weight:\s*700/);
        expect(baseBlock).toMatch(/text-decoration:\s*underline/);
    });

    it('gives .auth-link a lighter hover/focus color', () => {
        expect(hoverBlock).toMatch(/color:\s*#adb5bd/);
    });

    it.each(CASES)('%s: every link carries auth-link', (_name, file, markers) => {
        const src = read(file);
        for (const marker of markers) {
            expect(src, marker).toContain(marker);
        }
        const tags = anchorTags(src);
        expect(tags.length).toBeGreaterThan(0);
        for (const tag of tags) {
            expect(tag, tag).toContain('auth-link');
        }
    });
});
