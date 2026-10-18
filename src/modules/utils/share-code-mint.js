// Shared minting entry point for share codes.
//
// The authoritative generator is the Postgres function `generate_share_code()`
// (see supabase/migrations/010_short_share_codes.sql), which filters reserved
// words and checks the unique constraint. This helper calls it and falls back to
// the local generator in src/modules/utils/short-id.js when the RPC is
// unreachable, so signup and profile repair never block on a network blip.
import { supabase } from '../api/supabase.js';
import { generateShareCode, isShareCodeSegment, GENERATED_CODE_LENGTH } from './short-id.js';

export async function mintShareCode() {
    try {
        const { data, error } = await supabase.rpc('generate_share_code');
        if (error) throw error;
        if (isShareCodeSegment(data) && data.length === GENERATED_CODE_LENGTH) return data;
        console.warn('[share-code-mint] RPC returned a non-code value:', data);
    } catch (err) {
        console.warn('[share-code-mint] RPC failed, falling back to trigger mint:', err?.message || err);
    }
    // Do not mint locally: a client-side code bypasses the reserved-word and
    // uniqueness checks, and the trigger fills share_code when it is omitted.
    return null;
}

