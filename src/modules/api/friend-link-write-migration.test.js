import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the friend-link write migration. Supabase SQL cannot run in
// vitest, so this locks the security-relevant shape: ONE SECURITY DEFINER RPC
// that derives the owner from auth.uid() (the client can only ever write its
// OWN row), merges the entry atomically, and reads the share code from that
// row — no new table, no new RLS policy, no client-writable path to another
// user's row.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/011_record_friend_link.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('011_record_friend_link.sql', () => {
    it('creates the record_friend_link RPC as SECURITY DEFINER with a locked search_path', () => {
        expect(sql).toContain('create or replace function public.record_friend_link(');
        expect(sql).toContain('security definer');
        expect(sql).toContain("set search_path = ''");
    });

    it('derives the owner from auth.uid() and refuses an unauthenticated caller', () => {
        expect(sql).toContain('v_actor uuid := auth.uid()');
        expect(sql).toContain('record_friend_link: not authenticated');
        // The owner is the caller: the write can only ever touch the caller's
        // own row, so no share code / user id from the client can redirect it.
        expect(sql).toContain('where p.id = v_actor');
    });

    it('merges atomically instead of read-modify-writing the whole map', () => {
        expect(sql).toContain('jsonb_set(');
        expect(sql).toContain('coalesce(p.friend_links, \'{}\'::jsonb)');
        // One entry per recorded lesson, keyed courseId:recordedLessonId.
        expect(sql).toContain("v_key := p_course_id || ':' || p_recorded_lesson_id;");
    });

    it('builds the entry the public profile renders, with the share code from the caller\'s own row', () => {
        for (const field of ['courseId', 'courseName', 'recordedLessonId', 'lessonId', 'shareCode', 'lessonTitle', 'addedAt']) {
            expect(sql, `entry field ${field}`).toContain(`'${field}'`);
        }
        expect(sql).toContain("'shareCode', coalesce(p.share_code, '')");
        // addedAt is the 48h-window clock, written in the same ISO shape the
        // renderer parses.
        expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    });

    it('returns false for a call with no course, recorded lesson or follow-up', () => {
        expect(sql).toContain('or p_recorded_lesson_id is null');
        expect(sql).toContain('or p_next_lesson_id is null');
        expect(sql).toContain('return false;');
    });

    it('grants execute to authenticated only', () => {
        expect(sql).toContain('revoke all on function public.record_friend_link(text, text, text, text, text) from public, anon');
        expect(sql).toContain('grant execute on function public.record_friend_link(text, text, text, text, text) to authenticated');
    });

    it('creates no new table and no new RLS policy', () => {
        expect(sql).not.toMatch(/create\s+table/i);
        expect(sql).not.toMatch(/create\s+policy/i);
    });
});
