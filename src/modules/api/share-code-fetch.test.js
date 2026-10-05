import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchUserByShareCode } from './api.js';

// The share-code entry reuses the same lookup as the public profile. This locks
// the extracted function contract and the hook delegation by source (the
// Supabase path cannot run in vitest) plus a runtime shape check.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'api.js'), 'utf8');

describe('fetchUserByShareCode', () => {
    it('is an exported function', () => {
        expect(typeof fetchUserByShareCode).toBe('function');
    });
});

describe('api.js share-code lookup plumbing', () => {
    const hookAt = src.indexOf('export function useUserByShareCode');
    const hookSlice = src.slice(hookAt, src.indexOf('export function', hookAt + 1));

    const fetchAt = src.indexOf('export async function fetchUserByShareCode');
    const fetchSlice = src.slice(fetchAt, src.indexOf('export function', fetchAt + 1));

    it('has the useUserByShareCode hook registered', () => {
        expect(hookAt).toBeGreaterThan(-1);
    });

    it('delegates the hook to fetchUserByShareCode with the same key + enabled gate', () => {
        expect(hookSlice).toContain('fetchUserByShareCode(shareCode)');
        expect(hookSlice).toContain("['user', 'profile', 'shareCode', shareCode]");
        expect(hookSlice).toContain('enabled: !!shareCode');
    });

    it('falls back from the public view to the legacy table inside a catch', () => {
        const tryAt = fetchSlice.indexOf('try {');
        const catchAt = fetchSlice.indexOf('} catch {');
        const fallback = fetchSlice.slice(catchAt, catchAt + 120);
        expect(tryAt).toBeGreaterThan(-1);
        expect(catchAt).toBeGreaterThan(tryAt);
        expect(fetchSlice).toContain('queryPublicProfiles()');
        expect(fallback).toContain('return await queryLegacy();');
    });
});
