import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the lesson-completion migration. Supabase SQL cannot run in
// vitest, so this locks the security-relevant shape: ONE SECURITY DEFINER RPC
// that derives the learner from auth.uid() (so nobody can count a lesson for
// somebody else), owns the counters in a single atomic statement (the row is
// the baseline — no client baseline, no lost update), and reports a failure as
// an error the caller sees.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '../../../supabase/migrations/012_record_lesson_completion.sql');
const sql = readFileSync(SQL_PATH, 'utf8');

describe('012_record_lesson_completion.sql', () => {
    it('creates the record_lesson_completion RPC as SECURITY DEFINER with a locked search_path', () => {
        expect(sql).toContain('create or replace function public.record_lesson_completion(');
        expect(sql).toContain('security definer');
        expect(sql).toContain("set search_path = ''");
    });

    it('derives the learner from auth.uid() and refuses an unauthenticated caller', () => {
        expect(sql).toContain('v_actor uuid := auth.uid()');
        expect(sql).toContain('record_lesson_completion: not authenticated');
        expect(sql).toContain('where p.id = v_actor');
    });

    it('increments the counters in ONE statement, off the row\'s own values', () => {
        // One statement: the pre-update state and the update share a snapshot,
        // so the increment is atomic and the baseline is the row's own truth.
        expect(sql).toContain('with prior as (');
        expect(sql).toContain('update public.user_profiles p');
        expect(sql).toContain('lessons_completed = coalesce(p.lessons_completed, 0) + 1');
        expect(sql).toContain('not (prior.counted @> ARRAY[v_key]) as is_first_completion');
    });

    it('keeps counted_lessons a UNIQUE set and completed_dates a unique set of days', () => {
        expect(sql).toContain("not (p.counted_lessons @> ARRAY[v_key])");
        expect(sql).toContain("not (p.completed_dates @> ARRAY[v_today])");
    });

    it('builds the counted key from the course and the completed lesson', () => {
        expect(sql).toContain("v_key := p_course_id || '_' || p_completed_lesson_id;");
    });

    it('returns the resulting counters so the client can update its store', () => {
        for (const field of ['lessons_completed', 'counted_lessons', 'completed_dates', 'is_first_completion', 'day_added']) {
            expect(sql, `returned field ${field}`).toContain(`'${field}'`);
        }
    });

    it('grants execute to authenticated only', () => {
        expect(sql).toContain('revoke all on function public.record_lesson_completion(text, text) from public, anon');
        expect(sql).toContain('grant execute on function public.record_lesson_completion(text, text) to authenticated');
    });

    it('creates no new table and no new RLS policy', () => {
        expect(sql).not.toMatch(/create\s+table/i);
        expect(sql).not.toMatch(/create\s+policy/i);
    });
});
