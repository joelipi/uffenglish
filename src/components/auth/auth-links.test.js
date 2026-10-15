// Guard: auth navigation links (signup / login / forgot-password /
// back-to-login) render on dark-blue surfaces (the AuthLayout card and the
// bg-dark modals), where the default Bootstrap blue is unreadable. Every such
// link must carry the `auth-link` class (bold white), and the stylesheet must
// define that class as bold white — not the default blue.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODALS_DIR = path.join(HERE, '..', 'modals');
const CSS_PATH = path.join(HERE, '..', '..', 'assets', 'css', 'app.css');

const read = (p) => readFileSync(p, 'utf8');
const loginSrc = read(path.join(HERE, 'LoginForm.web.jsx'));
const signupSrc = read(path.join(HERE, 'SignupForm.web.jsx'));
const recoverSrc = read(path.join(HERE, 'RecoverPasswordForm.web.jsx'));
const saveClipsSrc = read(path.join(MODALS_DIR, 'SaveClipsSignupForm.jsx'));
const css = read(CSS_PATH);

// Scope to the single rule block so the guard can fail: a whole-file
// `toContain` stays green even when the rule is deleted.
const authLinkBlock = (() => {
    const start = css.indexOf('.auth-link {');
    if (start === -1) return '';
    return css.slice(start, css.indexOf('}', start) + 1);
})();

describe('auth navigation links use the high-contrast auth-link style', () => {
    it('defines the .auth-link rule (guards against a renamed selector)', () => {
        expect(authLinkBlock).not.toBe('');
    });

    it('styles .auth-link bold white with an underline', () => {
        expect(authLinkBlock).toMatch(/color:\s*#ffffff/);
        expect(authLinkBlock).toMatch(/font-weight:\s*700/);
        expect(authLinkBlock).toMatch(/text-decoration:\s*underline/);
    });

    it('gives .auth-link a lighter hover/focus color', () => {
        expect(css).toContain('.auth-link:hover');
        expect(css).toContain('.auth-link:focus-visible');
    });

    it('login form: signup and forgot-password links carry auth-link', () => {
        expect(loginSrc).toContain('auth_sign_up_link');
        expect(loginSrc).toContain('auth_forgot_password');
        const anchors = loginSrc.match(/<a\b[^>]*>/g) || [];
        expect(anchors.length).toBeGreaterThan(0);
        for (const a of anchors) {
            expect(a).toContain('auth-link');
        }
    });

    it('signup form: login link carries auth-link', () => {
        expect(signupSrc).toContain('auth_log_in_link');
        const anchors = signupSrc.match(/<a\b[^>]*>/g) || [];
        expect(anchors.length).toBeGreaterThan(0);
        for (const a of anchors) {
            expect(a).toContain('auth-link');
        }
    });

    it('recover-password form: back-to-login link carries auth-link', () => {
        expect(recoverSrc).toContain('auth_back_to_login');
        const anchors = recoverSrc.match(/<a\b[^>]*>/g) || [];
        expect(anchors.length).toBeGreaterThan(0);
        for (const a of anchors) {
            expect(a).toContain('auth-link');
        }
    });

    it('save-clips modal form: login link carries auth-link', () => {
        expect(saveClipsSrc).toContain('saveClipsLoginLink');
        const anchors = saveClipsSrc.match(/<a\b[^>]*>/g) || [];
        expect(anchors.length).toBeGreaterThan(0);
        for (const a of anchors) {
            expect(a).toContain('auth-link');
        }
    });
});
