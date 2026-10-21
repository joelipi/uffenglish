import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the pair-scoped joint-completion ledger. Supabase SQL cannot
// run in vitest, so this locks the security-relevant shape: the table stores
// (actor, owner, course, lesson); a learner may read ONLY their own rows; the
// only writer is the existing SECURITY DEFINER completion RPC; and the pair is
// recorded on the SAME completion that already credits the friendship, so the
// badge and the friend count can never disagree about what "together" means.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/013_add_friend_completions.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

/** The record_friend_completion body, bounded at the next top-level statement. */
function completionFunction() {
    const start = sql.indexOf('create or replace function public.record_friend_completion(');
    expect(start, 'record_friend_completion not found').toBeGreaterThan(-1);
    const end = sql.indexOf('revoke all on function public.record_friend_completion', start);
    expect(end, 'function end marker not found').toBeGreaterThan(start);
    return sql.slice(start, end);
}

/** The backfill statement only (the RPC also inserts into the same table). */
function backfillStatement() {
    const start = sql.indexOf('-- Backfill what the inbox proves');
    expect(start, 'backfill block not found').toBeGreaterThan(-1);
    const end = sql.indexOf('-- Same atomic friendship credit', start);
    expect(end, 'backfill end marker not found').toBeGreaterThan(start);
    return sql.slice(start, end);
}

describe('013_add_friend_completions.sql', () => {
    it('stores one pair-scoped row per (actor, owner, course, lesson)', () => {
        expect(sql).toContain('create table if not exists public.friend_completions');
        expect(sql).toMatch(/actor_id uuid not null references auth\.users\(id\) on delete cascade/);
        expect(sql).toMatch(/owner_id uuid not null references auth\.users\(id\) on delete cascade/);
        expect(sql).toContain('constraint friend_completions_unique unique (actor_id, owner_id, course_id, lesson_id)');
        expect(sql).toContain('constraint friend_completions_no_self check (actor_id <> owner_id)');
    });

    it('lets a learner read ONLY their own completions', () => {
        expect(sql).toContain('alter table public.friend_completions enable row level security');
        expect(sql).toMatch(
            /create policy "actor reads own completions"\s+on public\.friend_completions for select\s+to authenticated\s+using \(auth\.uid\(\) = actor_id\)/
        );
        expect(sql).toContain('grant select on table public.friend_completions to authenticated');
        expect(sql).not.toMatch(/grant select on table public\.friend_completions to anon/);
    });

    it('grants no write path: the SECURITY DEFINER RPC is the only writer', () => {
        // `grant insert/update/delete` would let a client forge a joint lesson
        // with any owner. The prose above mentions the words, but never as a
        // GRANT statement.
        expect(sql).not.toMatch(/grant\s+(insert|update|delete)/i);
    });

    it('records the pair from the completion RPC that already credits the friendship', () => {
        const fn = completionFunction();
        expect(fn).toContain('security definer');
        expect(fn).toContain("set search_path = ''");
        expect(fn).toContain('insert into public.friend_completions (actor_id, owner_id, course_id, lesson_id)');
        expect(fn).toContain('values (v_actor, v_owner, p_course_id, p_lesson_id)');
        expect(fn).toContain('on conflict (actor_id, owner_id, course_id, lesson_id)');
        expect(fn).toContain('do update set completed_at = now()');
        // It still credits the friendship: the ledger is an addition, not a
        // replacement.
        expect(fn).toContain('friend_owners =');
        expect(fn).toContain('friends =');
        expect(fn).toContain('referrals =');
    });

    it('records the pair only after the self/unknown-owner guard, and before the credit writes', () => {
        const fn = completionFunction();
        const guard = fn.indexOf('if v_owner is null or v_owner = v_actor then');
        const insert = fn.indexOf('insert into public.friend_completions');
        const credit = fn.indexOf('update public.user_profiles p');
        expect(guard).toBeGreaterThan(-1);
        expect(insert).toBeGreaterThan(guard);
        expect(credit).toBeGreaterThan(insert);
    });

    it('backfills the pair from the inbox rows that prove it', () => {
        const backfill = backfillStatement();
        expect(backfill).toContain('insert into public.friend_completions (actor_id, owner_id, course_id, lesson_id)');
        expect(backfill).toContain('select n.actor_id, n.recipient_id, n.course_id, n.lesson_id');
        expect(backfill).toContain('from public.user_notifications n');
        expect(backfill).toContain("where n.type = 'friend_response'");
        expect(backfill).toContain('on conflict (actor_id, owner_id, course_id, lesson_id) do nothing');
    });

    it('is idempotent so a second apply is harmless', () => {
        expect(sql).toContain('create table if not exists');
        expect(sql).toContain('create index if not exists');
        expect(sql).toContain('drop policy if exists');
        expect(sql).toContain('create or replace function');
    });
});
