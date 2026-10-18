// Shared minting entry point for share codes.
//
// The authoritative generator is the Postgres function `generate_share_code()`
// (see supabase/migrations/010_short_share_codes.sql), which filters reserved
// words and checks the unique constraint. This helper calls it; on failure it
// returns null so the DB trigger can mint instead (no client-side fallback).
import { supabase } from '../api/supabase.js';
import { isShareCodeSegment, GENERATED_CODE_LENGTH, normalizeShareCodeSegment } from './short-id.js';

export async function mintShareCode() {
    try {
        const { data, error } = await supabase.rpc('generate_share_code');
        if (error) throw error;
        if (isShareCodeSegment(data) && data.length === GENERATED_CODE_LENGTH) {
            // The RPC may return mixed case; normalize so the stored value is lowercase.
            return normalizeShareCodeSegment(data);
        }
        console.warn('[share-code-mint] RPC returned a non-code value:', data);
    } catch (err) {
        console.warn('[share-code-mint] RPC failed, falling back to trigger mint:', err?.message || err);
    }
    // Do not mint locally: a client-side code bypasses the reserved-word and
    // uniqueness checks, and the trigger fills share_code when it is omitted.
    return null;
}

