// Friend-credit sync: stashing guest credits and flushing them after auth.
// Effects live here (store + RPC) so the *-logic.js modules stay pure.

import { appStore } from '../store/store.js';
import { recordFriendCompletion } from '../api/api.js';
import { appendPendingCredit } from './friend-credit-logic.js';

// Stash a guest's credit for later. Deduped by key (unique-users semantics),
// so repeat completions before signup collapse to one pending entry.
export function stashPendingFriendCredit(credit) {
    const next = appendPendingCredit(appStore.getState().pendingFriendCredits, credit);
    appStore.getState().setPendingFriendCredits(next);
    return next;
}

// Send every stashed credit after signup/login. Entries that record keep
// their success; failures stay queued and retry on the next auth event.
// Fail-open by contract: never throws, never blocks the auth flow.
export async function flushPendingFriendCredits() {
    const pending = appStore.getState().pendingFriendCredits;
    if (!Array.isArray(pending) || pending.length === 0) return { flushed: 0, remaining: 0 };
    const remaining = [];
    let flushed = 0;
    for (const credit of pending) {
        try {
            const result = await recordFriendCompletion(credit);
            if (result && result.recorded) {
                flushed += 1;
            } else {
                remaining.push(credit);
            }
        } catch (error) {
            console.error('[friendCredit] flush failed (non-fatal, will retry):', error);
            remaining.push(credit);
        }
    }
    appStore.getState().setPendingFriendCredits(remaining);
    if (flushed > 0) console.log(`[friendCredit] flushed ${flushed} pending credit(s)`);
    return { flushed, remaining: remaining.length };
}
