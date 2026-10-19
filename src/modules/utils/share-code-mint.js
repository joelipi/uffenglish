// Shared minting entry point for share codes.
//
// The authoritative generator is the Postgres function `generate_share_code()`
// (see supabase/migrations/010_short_share_codes.sql), which filters reserved
// words and checks the unique constraint. If the RPC is unreachable or returns
// an unusable value, this helper falls back to the reserved-filtered local
// generator so signup and profile repair always get a code the DB trigger's
// validation can accept.
import { mintShareCodeMutation } from '../api/api.js';
import {
    isShareCodeSegment,
    normalizeShareCodeSegment,
    generateShareCode,
} from './short-id.js';
import { RESERVED_SHARE_CODES } from './reserved-share-codes.js';

export async function mintShareCode() {
    try {
        const { data, error } = await mintShareCodeMutation();
        if (error) throw error;
        if (typeof data === 'string' && isShareCodeSegment(data) && !RESERVED_SHARE_CODES.has(data.toLowerCase())) {
            return normalizeShareCodeSegment(data);
        }
        console.warn('[share-code-mint] RPC returned a non-code value; using local fallback:', data);
    } catch (err) {
        console.warn('[share-code-mint] RPC failed; using local fallback:', err?.message || err);
    }
    return generateShareCode();
}
