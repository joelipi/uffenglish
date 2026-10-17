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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(HERE, 'SignupForm.jsx'), 'utf8');

// Bounded to handleSubmit: from its signature to the hook's return statement.
const start = source.indexOf('async function handleSubmit(e) {');
const end = source.indexOf('\n    return {');
const region = source.slice(start, end);

const order = (token) => region.indexOf(token);

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

    it('imports the screen from the shared logic module', () => {
        expect(source).toMatch(/from '\.\.\/\.\.\/modules\/auth\/email-validation-logic\.js'/);
        expect(source).toMatch(/normalizeEmail/);
        expect(source).toMatch(/checkEmailAddress/);
    });
});
