import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api/api.js', () => ({
    recordFriendCompletion: vi.fn(),
}));

import { recordFriendCompletion } from '../api/api.js';
import { appStore } from '../store/store.js';
import { stashPendingFriendCredit, flushPendingFriendCredits } from './friend-credit-sync.js';

const b = { ownerShareCode: 'ab12', courseId: 'friendchain', lessonId: 'b' };
const c = { ownerShareCode: 'ab12', courseId: 'friendchain', lessonId: 'c' };

describe('stashPendingFriendCredit', () => {
    beforeEach(() => {
        appStore.setState({ pendingFriendCredits: [] });
    });

    it('queues distinct completions for the post-signup flush', () => {
        stashPendingFriendCredit(b);
        const next = stashPendingFriendCredit(c);
        expect(next).toEqual([b, c]);
        expect(appStore.getState().pendingFriendCredits).toEqual([b, c]);
    });

    it('collapses a repeat completion to one queued entry', () => {
        stashPendingFriendCredit(b);
        stashPendingFriendCredit({ ...b });
        expect(appStore.getState().pendingFriendCredits).toEqual([b]);
    });
});

describe('flushPendingFriendCredits', () => {
    beforeEach(() => {
        recordFriendCompletion.mockReset();
        appStore.setState({ pendingFriendCredits: [] });
    });

    it('sends every queued credit and clears the queue on success', async () => {
        recordFriendCompletion.mockResolvedValue({ recorded: true });
        appStore.setState({ pendingFriendCredits: [b, c] });

        const out = await flushPendingFriendCredits();

        expect(out).toEqual({ flushed: 2, remaining: 0 });
        expect(recordFriendCompletion).toHaveBeenCalledTimes(2);
        expect(recordFriendCompletion).toHaveBeenCalledWith(b);
        expect(recordFriendCompletion).toHaveBeenCalledWith(c);
        expect(appStore.getState().pendingFriendCredits).toEqual([]);
    });

    it('keeps failed credits queued and reports them', async () => {
        recordFriendCompletion
            .mockResolvedValueOnce({ recorded: true })
            .mockResolvedValueOnce({ recorded: false, reason: 'rpc-failed' });
        appStore.setState({ pendingFriendCredits: [b, c] });

        const out = await flushPendingFriendCredits();

        expect(out).toEqual({ flushed: 1, remaining: 1 });
        expect(appStore.getState().pendingFriendCredits).toEqual([c]);
    });

    it('keeps credits queued when the RPC throws, and never throws itself', async () => {
        recordFriendCompletion.mockRejectedValue(new Error('network down'));
        appStore.setState({ pendingFriendCredits: [b] });

        const out = await flushPendingFriendCredits();

        expect(out).toEqual({ flushed: 0, remaining: 1 });
        expect(appStore.getState().pendingFriendCredits).toEqual([b]);
    });

    it('is a no-op with an empty queue', async () => {
        const out = await flushPendingFriendCredits();
        expect(out).toEqual({ flushed: 0, remaining: 0 });
        expect(recordFriendCompletion).not.toHaveBeenCalled();
    });
});
