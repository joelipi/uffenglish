import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpcSpy } = vi.hoisted(() => ({ rpcSpy: vi.fn() }));

vi.mock('../api/supabase.js', () => ({
    supabase: { rpc: (...args) => rpcSpy(...args) },
}));

import { mintShareCode } from './share-code-mint.js';
import { isShareCodeSegment } from './short-id.js';

describe('mintShareCode', () => {
    beforeEach(() => rpcSpy.mockReset());

    it('returns the server-minted code when the RPC succeeds', async () => {
        rpcSpy.mockResolvedValue({ data: 'abcde', error: null });
        await expect(mintShareCode()).resolves.toBe('abcde');
        expect(rpcSpy).toHaveBeenCalledWith('generate_share_code');
    });

    it('normalizes mixed-case RPC output to lowercase', async () => {
        rpcSpy.mockResolvedValue({ data: 'ABCDE', error: null });
        await expect(mintShareCode()).resolves.toBe('abcde');
    });

    it('returns null when the RPC errors', async () => {
        rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });
        await expect(mintShareCode()).resolves.toBeNull();
    });

    it('returns null when the RPC returns a non-code value', async () => {
        rpcSpy.mockResolvedValue({ data: 'nope', error: null });
        await expect(mintShareCode()).resolves.toBeNull();
    });
});
