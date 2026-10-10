// Source guard for the non-blocking welcome-email wiring in the signup hook.
// The signup must complete whether or not the email is sent, so the send is
// fire-and-forget (`void sendWelcomeEmail()`), issued after the profile row is
// created and before the success callback. Ordering (not mere presence) is what
// makes it non-blocking, so the assertions compare indices — a hoisted call
// above the insert, or an `await`, would fail this guard.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'SignupForm.jsx'), 'utf8');

describe('SignupForm welcome-email wiring', () => {
    it('imports the fire-and-forget helper', () => {
        expect(src).toContain(
            "import { sendWelcomeEmail } from '../../modules/user/email-confirmation.js';"
        );
    });

    it('sends the welcome email after the profile insert and before onSignupSuccess', () => {
        const submitAt = src.indexOf('async function handleSubmit(e)');
        const endAt = src.indexOf('\n    return {', submitAt);
        expect(submitAt).toBeGreaterThan(-1);
        expect(endAt).toBeGreaterThan(submitAt);
        const region = src.slice(submitAt, endAt);

        const insertAt = region.indexOf(".from('user_profiles').insert(");
        const sendAt = region.indexOf('void sendWelcomeEmail();');
        const successAt = region.indexOf('onSignupSuccess?.();');

        expect(insertAt, 'profile insert call').toBeGreaterThan(-1);
        expect(sendAt, 'void sendWelcomeEmail() call').toBeGreaterThan(-1);
        expect(successAt, 'onSignupSuccess callback').toBeGreaterThan(-1);
        expect(insertAt).toBeLessThan(sendAt);
        expect(sendAt).toBeLessThan(successAt);
    });

    it('never awaits the email — an awaited send could block signup', () => {
        const submitAt = src.indexOf('async function handleSubmit(e)');
        const endAt = src.indexOf('\n    return {', submitAt);
        const region = src.slice(submitAt, endAt);
        expect(region).not.toContain('await sendWelcomeEmail');
    });
});
