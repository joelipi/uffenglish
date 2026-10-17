// Story 070 review: the four SignupForm submit suites each waited for the async
// signup chain (captcha -> email gate -> signUp -> profile write) with the same
// copied poll loop, differing only in the iteration cap. Copied timing code
// drifts; this is the single copy.
//
// `loading` stays true across the whole chain and clears only in handleSubmit's
// `finally`, so `loading === 'false'` IS the end-of-chain signal. A fixed sleep
// was a timing assumption: it held when a file ran alone but not under the full
// suite's load, where the post-signUp profile write had not landed yet and the
// call-count assertions failed intermittently.
//
// Every poll flushes React through `act`, exactly as the single sleep did. The
// first empty `act` flushes `setLoading(true)`, so the loop cannot read 'false'
// in the gap between the click dispatch and the chain starting.
import { act } from 'react';

export const SIGNUP_CHAIN_POLL_LIMIT = 400;

/**
 * Resolve once `isDone()` reports the signup chain finished, or throw.
 *
 * Throwing on exhaustion is deliberate: a loop that falls out silently turns a
 * hung chain into a confusing downstream failure — or, for an assertion like
 * `expect(insertCalls).toEqual([])`, into a vacuous pass.
 */
export async function waitForSignupChain(isDone, { maxPolls = SIGNUP_CHAIN_POLL_LIMIT } = {}) {
    await act(async () => {});
    for (let poll = 0; poll < maxPolls; poll += 1) {
        if (isDone()) return;
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    throw new Error(`signup chain did not settle within ${maxPolls} polls`);
}
