// Static guard for migration 006. Supabase SQL cannot run in vitest, so this
// locks the security-relevant shape against the raw SQL (never comment-stripped
// — docs/learnings.md:19-23):
//   * the email_confirmed columns are server-managed (a trigger rejects every
//     anon/authenticated write, so a user cannot self-confirm);
//   * the token table grants nobody but the service role;
//   * the RPC only burns the token and reports success once a profile row was
//     actually updated.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/006_add_email_confirmation.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('006_add_email_confirmation.sql', () => {
    it('adds the server-managed email_confirmed columns to user_profiles', () => {
        expect(sql).toContain('alter table public.user_profiles');
        expect(sql).toContain('email_confirmed boolean not null default false');
        expect(sql).toContain('email_confirmed_at timestamptz');
    });

    it('rejects anon/authenticated writes to the flag via a before insert/update trigger', () => {
        expect(sql).toContain('create or replace function public.protect_email_confirmed()');
        expect(sql).toContain("current_user in ('anon', 'authenticated')");
        expect(sql).toContain("raise exception 'email_confirmed is server-managed'");
        expect(sql).toContain('create trigger user_profiles_protect_email_confirmed');
        expect(sql).toContain('before insert or update on public.user_profiles');
        // INSERT forging is blocked too (a user could otherwise create their row
        // already confirmed).
        expect(sql).toContain('new.email_confirmed is distinct from false');
        expect(sql).toContain('new.email_confirmed is distinct from old.email_confirmed');
    });

    it('stores only a hashed token and grants the table to nobody but the service role', () => {
        expect(sql).toContain('create table if not exists public.email_confirm_tokens');
        expect(sql).toContain('token_hash text primary key');
        expect(sql).toContain('alter table public.email_confirm_tokens enable row level security');
        expect(sql).toContain('revoke all on table public.email_confirm_tokens from anon, authenticated');
        expect(sql).toContain('grant all on table public.email_confirm_tokens to service_role');
        // No RLS policy at all — the service role bypasses RLS; everyone else is
        // denied. A policy here would re-open the self-forge path.
        expect(sql).not.toMatch(/create policy[^;]*email_confirm_tokens/i);
    });

    it('defines the anon RPC as SECURITY DEFINER with a locked search_path', () => {
        expect(sql).toContain('create or replace function public.confirm_email_hash(p_hash text)');
        expect(sql).toContain('security definer');
        expect(sql).toContain("set search_path = ''");
        expect(sql).toContain('revoke all on function public.confirm_email_hash(text) from public');
        expect(sql).toContain('grant execute on function public.confirm_email_hash(text) to anon, authenticated');
    });

    it('only reports success and burns the token after the profile row was updated', () => {
        const updateAt = sql.indexOf('returning id into v_updated');
        const nullCheckAt = sql.indexOf('if v_updated is null then');
        const deleteAt = sql.indexOf('delete from public.email_confirm_tokens where user_id = v_user');
        expect(updateAt).toBeGreaterThan(-1);
        expect(nullCheckAt).toBeGreaterThan(updateAt);
        expect(deleteAt).toBeGreaterThan(nullCheckAt);
    });
});
