import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the friend_links migration. Supabase SQL cannot run in
// vitest, so this locks the security-relevant shape: one new jsonb column on
// user_profiles, exposed publicly only through the existing anon column GRANT
// and the public_profiles view — no new table, no new RLS policy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/004_add_friend_links_to_profiles.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('004_add_friend_links_to_profiles.sql', () => {
    it('adds the friend_links jsonb column to user_profiles', () => {
        expect(sql).toContain('alter table public.user_profiles');
        expect(sql).toContain('add column if not exists friend_links jsonb');
    });

    it('extends the anon column GRANT with friend_links', () => {
        expect(sql).toContain('grant select (friend_links) on table public.user_profiles to anon');
    });

    it('exposes friend_links through the public_profiles view', () => {
        expect(sql).toContain('create or replace view public.public_profiles');
        expect(sql).toContain('friend_links');
        expect(sql).toContain('grant select on public.public_profiles to anon, authenticated');
    });

    it('creates no new table and no new RLS policy', () => {
        expect(sql).not.toMatch(/create\s+table/i);
        expect(sql).not.toMatch(/create\s+policy/i);
    });
});
