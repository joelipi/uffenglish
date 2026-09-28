import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the user_notifications migration. Supabase SQL cannot run in
// vitest, so this locks the security-relevant shape: a recipient-scoped table
// (read + read_at update only), no insert grant/policy, and a SECURITY DEFINER
// RPC that derives the actor from the JWT. Assertions run against the raw SQL
// (never comment-stripped — docs/learnings.md:19-23).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/005_add_user_notifications.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('005_add_user_notifications.sql', () => {
    it('creates the user_notifications table with the expected columns', () => {
        expect(sql).toContain('create table if not exists public.user_notifications');
        for (const col of [
            'recipient_id',
            'actor_id',
            'type',
            'course_id',
            'lesson_id',
            'payload',
            'created_at',
            'read_at',
        ]) {
            expect(sql).toContain(col);
        }
    });

    it('enables RLS and scopes read + read_at update to the recipient', () => {
        expect(sql).toContain('alter table public.user_notifications enable row level security');
        expect(sql).toContain('auth.uid() = recipient_id');
        expect(sql).toContain('with check (auth.uid() = recipient_id)');
        expect(sql).toContain('grant update (read_at) on table public.user_notifications to authenticated');
    });

    it('never grants insert or adds an insert policy (writes only through the RPC)', () => {
        expect(sql).not.toMatch(/grant\s+insert/i);
        expect(sql).not.toMatch(/for\s+insert/i);
    });

    it('dedupes on recipient/actor/type and excludes attacker-controlled course/lesson', () => {
        expect(sql).toContain('uq_user_notifications_dedupe');
        expect(sql).toContain('on public.user_notifications (recipient_id, actor_id, type)');
        // The unique key must not include caller-supplied context, or an
        // authenticated caller could flood a victim's inbox with fake courses.
        expect(sql).not.toContain('(recipient_id, actor_id, type, course_id, lesson_id)');
    });

    it('defines the SECURITY DEFINER RPC and locks it down to authenticated', () => {
        expect(sql).toContain('create or replace function public.record_friend_response');
        expect(sql).toContain('security definer');
        expect(sql).toContain("set search_path = ''");
        expect(sql).toContain('v_actor uuid := auth.uid()');
        expect(sql).toContain('on conflict (recipient_id, actor_id, type)');
        expect(sql).toContain('grant execute on function public.record_friend_response(text, text, text) to authenticated');
        expect(sql).toContain('revoke all on function public.record_friend_response(text, text, text) from public, anon');
    });
});
