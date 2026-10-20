import { describe, it, expect, vi, beforeEach } from 'vitest';

// The completion counters are written by a server-side RPC
// (record_lesson_completion, migration 012), so the client's own write must
// NOT carry them: a client-side copy is written from a store copy that may be
// stale, and it would overwrite the server's row. This guard pins that.
vi.mock('../api/supabase.js', () => ({
    supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) },
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

const userProfile = read('user-profile.js');
const api = read('..', 'api', 'api.js');

describe('the lesson completion is counted server-side', () => {
    it('calls the RPC with the course and the COMPLETED lesson', () => {
        expect(userProfile).toContain('recordLessonCompletion({ courseId, completedLessonId })');
        expect(api).toContain("supabase.rpc('record_lesson_completion'");
        expect(api).toContain('p_course_id: courseId');
        expect(api).toContain('p_completed_lesson_id: completedLessonId');
    });

    it('counts the completed lesson, not the next-lesson resume target', () => {
        const start = userProfile.indexOf('const completedLessonId =');
        expect(start).toBeGreaterThan(-1);
        const block = userProfile.slice(start, start + 400);
        expect(block).toContain('safeOptions.completedLessonId || safeOptions.currentLessonId');
    });

    it('does not write the counters from the client', () => {
        // A client-side copy of the counters would overwrite the server's row
        // (and is the shape that could be lost silently).
        expect(userProfile).not.toContain('metaToUpdate.lessons_completed =');
        expect(userProfile).not.toContain('metaToUpdate.counted_lessons =');
        expect(userProfile).not.toContain('metaToUpdate.completed_dates =');
    });

    it('counts only a genuine completion (the phantom guard still applies)', () => {
        const start = userProfile.indexOf('const completedLessonId =');
        const block = userProfile.slice(start, start + 700);
        expect(block).toContain('safeOptions.incrementCount === true');
    });

    it('records the completion even when the store has no profile copy', () => {
        // The counters are keyed on the session (auth.uid()), so they must not
        // sit behind the `updateUserMetaFlag && userData` gate — that gate is
        // for the resume state, which does need a profile copy.
        const rpcCall = userProfile.indexOf('await recordLessonCompletion(');
        const gate = userProfile.indexOf('if (updateUserMetaFlag && userData) {');
        expect(rpcCall).toBeGreaterThan(-1);
        expect(gate).toBeGreaterThan(-1);
        expect(rpcCall).toBeLessThan(gate);
    });
});
