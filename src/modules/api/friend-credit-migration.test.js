import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the friend-credit migration. Supabase SQL cannot run in
// vitest, so this locks the security-relevant shape: three new columns,
// public exposure of the two display counts only (never friend_owners), and a
// single SECURITY DEFINER RPC that derives the actor from auth.uid() — no new
// table, no new RLS policy, no client-writable path to another user's row.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/007_friend_credit.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('007_friend_credit.sql', () => {
    it('adds the friends, referrals, and friend_owners columns to user_profiles', () => {
        expect(sql).toContain('alter table public.user_profiles');
        expect(sql).toMatch(/add column if not exists friends text\[\]/);
        expect(sql).toMatch(/add column if not exists referrals integer/);
        expect(sql).toMatch(/add column if not exists friend_owners text\[\]/);
    });

    it('exposes only the display counts to anon, never friend_owners', () => {
        expect(sql).toContain('grant select (friends, referrals) on table public.user_profiles to anon');
        expect(sql, 'friend_owners must stay private').not.toMatch(/grant select \([^\n]*friend_owners/);
    });

    it('exposes friends and referrals through the public_profiles view', () => {
        expect(sql).toContain('create or replace view public.public_profiles');
        expect(sql).toContain('grant select on public.public_profiles to anon, authenticated');
        const viewStart = sql.indexOf('create or replace view public.public_profiles');
        const viewEnd = sql.indexOf(';', sql.indexOf('where share_code is not null', viewStart));
        const viewRegion = sql.slice(viewStart, viewEnd);
        expect(viewRegion).toContain('friends,');
        expect(viewRegion).toContain('referrals');
        expect(viewRegion, 'friend_owners must not be in the public view').not.toContain('friend_owners');
    });

    it('creates the record_friend_completion RPC as SECURITY DEFINER with a locked search_path', () => {
        expect(sql).toContain('create or replace function public.record_friend_completion(');
        expect(sql).toContain('security definer');
        expect(sql).toContain("set search_path = ''");
    });

    it('derives the actor from auth.uid() and resolves the owner from the share code', () => {
        expect(sql).toContain('v_actor uuid := auth.uid()');
        expect(sql).toMatch(/where lower\(p\.share_code\) = lower\(btrim\(p_owner_share_code\)\)/);
    });

    it('treats unknown owner and self-completion as no-ops, never errors', () => {
        expect(sql).toContain('if v_owner is null or v_owner = v_actor then');
    });

    it('appends append-if-absent on both arrays and gates the referral on first-timing', () => {
        expect(sql).toContain('array_position(p.friends, v_actor::text) is null');
        expect(sql).toContain('array_position(p.friend_owners, v_owner::text) is null');
        expect(sql).toContain('referrals = p.referrals + (case when v_actor_first then 1 else 0 end)');
    });

    it('grants execute to authenticated only', () => {
        expect(sql).toContain('revoke all on function public.record_friend_completion(text, text, text) from public, anon');
        expect(sql).toContain('grant execute on function public.record_friend_completion(text, text, text) to authenticated');
    });

    it('creates no new table and no new RLS policy', () => {
        expect(sql).not.toMatch(/create\s+table/i);
        expect(sql).not.toMatch(/create\s+policy/i);
    });
});
