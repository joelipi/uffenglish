import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mintSpy } = vi.hoisted(() => ({ mintSpy: vi.fn() }));

vi.mock('../api/api.js', () => ({
    mintShareCodeMutation: (...args) => mintSpy(...args),
}));

import { mintShareCode } from './share-code-mint.js';
import { isShareCodeSegment } from './short-id.js';
import { RESERVED_SHARE_CODES } from './reserved-share-codes.js';

describe('mintShareCode', () => {
    beforeEach(() => mintSpy.mockReset());

    it('returns the server-minted code when the RPC succeeds', async () => {
        mintSpy.mockResolvedValue({ data: 'abcde', error: null });
        await expect(mintShareCode()).resolves.toBe('abcde');
        expect(mintSpy).toHaveBeenCalled();
    });

    it('normalizes mixed-case RPC output to lowercase', async () => {
        mintSpy.mockResolvedValue({ data: 'ABCDE', error: null });
        await expect(mintShareCode()).resolves.toBe('abcde');
    });

    it('falls back to a reserved-filtered local code when the RPC errors', async () => {
        mintSpy.mockResolvedValue({ data: null, error: new Error('boom') });
        const code = await mintShareCode();
        expect(isShareCodeSegment(code)).toBe(true);
        expect(RESERVED_SHARE_CODES.has(code)).toBe(false);
    });

    it('falls back when the RPC returns a non-code value', async () => {
        mintSpy.mockResolvedValue({ data: 'ab-cd', error: null });
        const code = await mintShareCode();
        expect(isShareCodeSegment(code)).toBe(true);
    });
});
