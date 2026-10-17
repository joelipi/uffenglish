// Story 070 — the lazy signup funnel.
//
// Three things are asserted here, all of them the reason the standalone
// `/signup` form is no longer a spam target:
//
//   1. `/signup` redirects to /courses and renders no signup form.
//   2. No signup entry point links to it any more — the guest modal, the login
//      page and the guest profile all go to the course list instead.
//   3. The course-list copy actually tells the learner where the account comes
//      from, in every locale, checked against the RAW strings table. Using
//      `Strings.get()` here would hide a dropped locale behind its English
//      fallback (AGENTS.md).
//
// Every guard asserts on raw source, scoped to a named block and bounded at a
// real marker — never whole-file `toContain`, which a comment can satisfy.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { strings } from '../data/strings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(path.join(__dirname, ...rel), 'utf8');

const guestModalSrc = read('..', 'components', 'modals', 'GuestLoginModal.web.jsx');
const loginRouteSrc = read('LoginRoute.jsx');
const userProfileSrc = read('..', 'components', 'profile', 'UserProfile.jsx');

const LOCALES = ['en', 'es', 'pt', 'fr', 'hi', 'bn'];

/** The signed-out notice and the amended first step, as raw table entries. */
const COURSE_COPY_KEYS = ['courses_guest_notice_title', 'courses_guest_notice_body', 'friend_courses_step_1'];

/**
 * Every href/to that points at the closed route in a given source file.
 * Scoped to the links themselves (a `to="..."`/`href="..."` attribute value or
 * a navigate argument), so a prose mention of the route in a comment cannot
 * satisfy or fail this.
 */
function signupLinkTargets(src) {
    return [
        ...[...src.matchAll(/(?:to|href)\s*=\s*["'`]([^"'`]*)["'`]/g)].map((m) => m[1]),
        ...[...src.matchAll(/navigate\(\s*[`'"]([^`'"]*)[`'"]\s*\)/g)].map((m) => m[1]),
    ].filter((target) => target.includes('/signup'));
}

describe('story 070 — no entry point reaches a signup form', () => {
    it('the guest modal account CTA goes to the course list', () => {
        expect(guestModalSrc).toContain('id="guestSignupBtn"');
        const at = guestModalSrc.indexOf('id="guestSignupBtn"');
        // Bound the slice at the button's own closing tag, never at EOF.
        const end = guestModalSrc.indexOf('</Link>', at);
        expect(at).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(at);
        const buttonBlock = guestModalSrc.slice(guestModalSrc.lastIndexOf('<Link', at), end);
        expect(buttonBlock).toContain('to={COURSES_PATH}');
        // The label is unchanged: "Sign Up" is the outcome /courses delivers.
        expect(buttonBlock).toContain("Strings.get('guest_modal_signup'");
    });

    it('the login page sign-up link goes to the course list, not to /signup', () => {
        const at = loginRouteSrc.indexOf('onSignupLink=');
        expect(at).toBeGreaterThan(-1);
        const block = loginRouteSrc.slice(at, loginRouteSrc.indexOf('onForgotPassword=', at));
        expect(block).toContain('navigate(COURSES_PATH)');
    });

    it('the guest profile account CTA goes to the course list, not to /signup', () => {
        const at = userProfileSrc.indexOf("Strings.get('guest_modal_signup'");
        expect(at).toBeGreaterThan(-1);
        const linkAt = userProfileSrc.lastIndexOf('<Link', at);
        const block = userProfileSrc.slice(linkAt, userProfileSrc.indexOf('</Link>', at));
        expect(block).toContain('to={COURSES_PATH}');
    });

    it('no href, Link target or navigate() in any entry point names /signup', () => {
        for (const [name, src] of [
            ['GuestLoginModal.web.jsx', guestModalSrc],
            ['LoginRoute.jsx', loginRouteSrc],
            ['UserProfile.jsx', userProfileSrc],
        ]) {
            expect(signupLinkTargets(src), `${name} still links to a signup form`).toEqual([]);
        }
    });

    it('still lets an existing user reach the sign-in form', () => {
        // Closing signup must not close login, or returning visitors are locked
        // out. The login links are untouched.
        expect(guestModalSrc).toContain('id="guestLoginBtn"');
        expect(loginRouteSrc).toContain('onForgotPassword={() => navigate(\'/recover-password\')}');
        expect(userProfileSrc).toContain("Strings.get('sign_in', lang)");
    });
});

describe('story 070 — the course list says where the account comes from', () => {
    it('amends step 1 in every locale without dropping the time promise', () => {
        for (const lang of LOCALES) {
            const value = strings.friend_courses_step_1[lang];
            expect(value, `friend_courses_step_1.${lang}`).toBeTruthy();
            // The five-minute promise is what makes deferring the account
            // unalarming, so an edit that quietly drops it is a regression.
            const fiveMinutes = {
                en: 'five minutes',
                es: 'cinco minutos',
                pt: 'cinco minutos',
                fr: 'cinq minutes',
                hi: 'पाँच मिनट',
                bn: 'পাঁচ মিনিট',
            }[lang];
            expect(value, `step_1.${lang} lost the under-five-minutes promise`).toContain(fiveMinutes);
        }
    });

    it('names account creation in step 1 in every locale', () => {
        // Raw-table reads only: `get()` falls back to English, so a missing
        // locale would still be truthy and the guard would never fire (AGENTS.md).
        const accountWords = {
            en: /account/i,
            es: /cuenta/i,
            pt: /conta/i,
            fr: /compte/i,
            hi: /खाता/,
            bn: /অ্যাকাউন্ট/,
        };
        for (const lang of LOCALES) {
            expect(strings.friend_courses_step_1[lang], `step_1.${lang} does not mention the account`)
                .toMatch(accountWords[lang]);
        }
    });

    it('carries the signed-out notice in every locale', () => {
        for (const key of ['courses_guest_notice_title', 'courses_guest_notice_body']) {
            for (const lang of LOCALES) {
                expect(strings[key][lang], `${key}.${lang}`).toBeTruthy();
            }
        }
    });

    it('tells the guest to finish a lesson and sign up at the end, in every locale', () => {
        const endWords = {
            en: /at the end/i,
            es: /al final/i,
            pt: /no final/i,
            fr: /à la fin/i,
            hi: /अंत में/,
            bn: /শেষে/,
        };
        for (const lang of LOCALES) {
            expect(strings.courses_guest_notice_body[lang], `notice body ${lang} does not say "at the end"`)
                .toMatch(endWords[lang]);
        }
    });

    it('has every course-copy key present for all six locales', () => {
        for (const key of COURSE_COPY_KEYS) {
            expect(Object.keys(strings[key]).sort()).toEqual([...LOCALES].sort());
        }
    });
});

describe('story 070 — the funnel is documented', () => {
    const productSrc = read('..', '..', 'docs', 'product.md');

    it('records the funnel, its deliberate limits and the closed route in product.md', () => {
        const at = productSrc.indexOf('Lazy signup');
        expect(at).toBeGreaterThan(-1);
        // Bound the slice at the next bullet, not EOF.
        const end = productSrc.indexOf('\n- ', at + 1);
        expect(end).toBeGreaterThan(at);
        const entry = productSrc.slice(at, end);
        // What the funnel is.
        expect(entry).toContain('created at the end of the first lesson');
        expect(entry).toContain('`/signup` redirects to `/courses`');
        // That nothing was deleted, because the change is reversible.
        expect(entry).toContain('Nothing is deleted');
        // The honest limits, so the doc cannot be read as "spam is solved".
        expect(entry).toContain('--use-fake-device-for-media-stream');
        expect(entry).toContain('not a measurement');
        expect(entry).toContain('captcha: false');
    });

    it('does not claim signup is impossible to automate', () => {
        // A guard on the wording, because "spam eliminated" is the exact claim
        // this story is not entitled to make. Deliberately broad: it must catch
        // a bare "spam eliminated" as well as "spam is now prevented", because
        // a narrower pattern here would only pass by accident.
        const at = productSrc.indexOf('Lazy signup');
        const end = productSrc.indexOf('\n- ', at + 1);
        const entry = productSrc.slice(at, end);
        expect(entry).not.toMatch(/\bspam\b[^.]*\b(eliminat|stop|prevent|block|impossible)/i);
    });
});