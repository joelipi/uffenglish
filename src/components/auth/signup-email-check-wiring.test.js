// Source guard for the signup email screen's wiring order.
//
// A behavioural test proves the screen blocks a rejected address today; this
// pins the ORDER in the source, which is what the gate actually depends on. If
// the check is ever moved below supabase.auth.signUp, an account would be
// created before the address was screened and every behavioural test could
// still pass, because each one drives the hook with the check in place.
//
// Guard rules applied (AGENTS.md):
//  - raw source, never comment-stripped: the call tokens contain no "//", but
//    stripping would also erase anything a future URL-shaped token introduces.
//  - the slice ends at the first "\n    return {" — the hook's return block —
//    never a slice to EOF, or a later function would silently join it.
//  - index-order assertions on paren-qualified call tokens, so a comment
//    naming the function cannot satisfy the search.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(HERE, 'SignupForm.jsx'), 'utf8');

// Bounded to handleSubmit: from its signature to the hook's return statement.
const start = source.indexOf('async function handleSubmit(e) {');
const end = source.indexOf('\n    return {');
const region = source.slice(start, end);

const order = (token) => region.indexOf(token);

/**
 * Every component that CALLS useSignupForm and renders a signup form.
 *
 * Discovered rather than listed, so a new signup surface cannot silently skip
 * the verdict guards below. Two filters, both semantic rather than hardcoded:
 *  - test files are excluded, since their harnesses call the hook too;
 *  - a real surface must render a <form>, which excludes the `return null`
 *    native stub (it only names the hook in a comment, and the repo treats
 *    unwired native files as reference rather than a live surface);
 *  - line comments are stripped for the call check, so naming the hook in a
 *    TODO is not mistaken for calling it.
 */
function findSurfaces() {
    const componentsDir = path.resolve(HERE, '..');
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.jsx?$/.test(entry.name) || /\.test\.jsx?$/.test(entry.name)) continue;
            const text = readFileSync(full, 'utf8');
            const code = text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
            const defines = /export\s+function\s+useSignupForm\b/.test(code);
            if (!defines && /useSignupForm\s*\(/.test(code) && /<form\b/.test(text)) {
                found.push({ name: entry.name, text });
            }
        }
    };
    walk(componentsDir);
    return found;
}

describe('signup email screen wiring', () => {
    it('locates handleSubmit and its bounded return block', () => {
        expect(start, 'handleSubmit signature not found').toBeGreaterThan(-1);
        expect(end, 'hook return block not found').toBeGreaterThan(-1);
        expect(end, 'slice must start before it ends').toBeGreaterThan(start);
        // The slice must not have run away to the end of the file.
        expect(region.length).toBeLessThan(source.length);
    });

    it('screens the address after the captcha gate and before signUp', () => {
        expect(order('getCaptchaToken('), 'captcha token call').toBeGreaterThan(-1);
        expect(order('verifyTurnstileToken('), 'captcha verify call').toBeGreaterThan(-1);
        expect(order('checkEmailAddress('), 'email screen call').toBeGreaterThan(-1);
        expect(order('supabase.auth.signUp('), 'signUp call').toBeGreaterThan(-1);

        // The order is the contract: a check placed after signUp would screen
        // an account that already exists.
        expect(order('getCaptchaToken(')).toBeLessThan(order('verifyTurnstileToken('));
        expect(order('verifyTurnstileToken(')).toBeLessThan(order('checkEmailAddress('));
        expect(order('checkEmailAddress(')).toBeLessThan(order('supabase.auth.signUp('));
    });

    it('sets the reason code before returning, and returns without calling signUp', () => {
        const check = order('checkEmailAddress(');
        const signUp = order('supabase.auth.signUp(');
        // Paren-qualified with its argument: the bare token `setEmailError(`
        // first matches the reset at the top of handleSubmit, which says
        // nothing about the rejection path.
        const setError = order('setEmailError(emailVerdict.reason)');
        const setSuggestion = order('setEmailSuggestion(emailVerdict.suggestion');

        expect(setError, 'the rejection must assign the reason code').toBeGreaterThan(check);
        expect(setSuggestion).toBeGreaterThan(setError);
        expect(setError, 'the reason code must be set before signUp').toBeLessThan(signUp);

        // The early return has to sit between the rejection and signUp, or the
        // rejection would fall through and create the account anyway.
        const guard = region.slice(check, signUp);
        expect(guard).toMatch(/if\s*\(\s*!\s*emailVerdict\.valid\s*\)/);
        expect(guard).toMatch(/\breturn;/);
    });

    it('exposes the code and the suggestion from the hook rather than copy', () => {
        // Logic owns decisions, display owns language: the hook's return block
        // must name the code, not a translated message.
        const returnBlock = source.slice(source.indexOf('\n    return {'));
        expect(returnBlock).toMatch(/emailError/);
        expect(returnBlock).toMatch(/emailSuggestion/);
        expect(returnBlock).not.toMatch(/auth_email_error_/);
    });

    it('returns every name each useSignupForm surface destructures', () => {
        // A view that destructures a key the hook does not return gets
        // `undefined` — silently green until a user types. Compare the two
        // lists exactly rather than grepping for one substring.
        const hookReturned = /return\s*\{([\s\S]*?)\n {4}\};\n\}/.exec(source);
        expect(hookReturned, 'could not find the hook return block').toBeTruthy();
        const returnedNames = hookReturned[1].split(',').map((s) => s.trim()).filter(Boolean);
        expect(returnedNames.length, 'the slice looks wrong — guard would be vacuous')
            .toBeGreaterThan(5);

        for (const { name, text } of findSurfaces()) {
            const destructured = /const\s*\{([\s\S]*?)\}\s*=\s*useSignupForm/.exec(text);
            expect(destructured, `could not find the useSignupForm destructuring in ${name}`)
                .toBeTruthy();
            for (const key of destructured[1].split(',').map((s) => s.trim()).filter(Boolean)) {
                expect(returnedNames, `${name} destructures "${key}", which useSignupForm does not return`)
                    .toContain(key);
            }
        }
    });

    it('does not export a bare address setter that would bypass the clearing', () => {
        // handleEmailChange clears the stale verdict; setEmail would not. With
        // setEmail exported, a view could write the address through it and the
        // stale alert would return with no visible cause.
        const hookReturned = /return\s*\{([\s\S]*?)\n {4}\};\n\}/.exec(source);
        const returnedNames = hookReturned[1].split(',').map((s) => s.trim());
        expect(returnedNames, 'setEmail would let a view bypass the clearing')
            .not.toContain('setEmail');
        expect(returnedNames).toContain('handleEmailChange');
    });

    it('routes every email input through handleEmailChange', () => {
        // The clearing is only reached if the input actually calls the hook.
        for (const { name, text } of findSurfaces()) {
            expect(text, `${name} does not route its email input through handleEmailChange`)
                .toMatch(/onChange=\{\(e\)\s*=>\s*handleEmailChange\(e\.target\.value\)\}/);
        }
    });

    it('renders the resolved verdict on every surface', () => {
        // Scoped to the alert block, not a whole-file token search: a bare
        // `toContain('emailError')` is satisfied by the destructuring alone, so
        // deleting the alert while keeping the destructure would stay green.
        for (const { name, text } of findSurfaces()) {
            const start = text.indexOf('{emailError &&');
            expect(start, `${name} renders no emailError alert at all`).toBeGreaterThan(-1);

            // Bound the slice at the next <form, i.e. the end of the alert block.
            const end = text.indexOf('<form', start);
            const block = text.slice(start, end === -1 ? text.length : end);

            expect(block, `${name} alert has no alert role`).toContain('role="alert"');
            expect(block, `${name} alert has no testid`).toContain('data-testid="email-error"');
            // The code must be resolved to copy INSIDE the alert, not merely
            // imported somewhere in the file.
            expect(block, `${name} alert does not resolve the code to copy`)
                .toMatch(/Strings\.get\(\s*emailValidationErrorKey\(emailError\)/);
        }
    });

    it('finds every useSignupForm surface, so a new one cannot skip the gate', () => {
        // Guards that enumerate files only check the files they name. This
        // discovers them, so adding a third signup surface fails here.
        expect(findSurfaces().map((s) => s.name).sort())
            .toEqual(['SaveClipsSignupForm.jsx', 'SignupForm.web.jsx']);
    });

    it('imports the screen from the shared logic module', () => {
        expect(source).toMatch(/from '\.\.\/\.\.\/modules\/auth\/email-validation-logic\.js'/);
        expect(source).toMatch(/normalizeEmail/);
        expect(source).toMatch(/checkEmailAddress/);
    });
});
