import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The public-profile badge asks "did THIS viewer complete THIS owner's linked
// lesson WITH that owner?". `counted_lessons` cannot answer it (per learner,
// per lesson, no partner), so the read is the pair-scoped `friend_completions`
// table. The isolation is the query itself: BOTH filters must be present, or a
// lesson done with one friend badges on another friend's profile.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(__dirname, 'api.js'), 'utf8');

function fetchBody() {
    const start = SOURCE.indexOf('export async function fetchFriendCompletions');
    expect(start, 'fetchFriendCompletions not found').toBeGreaterThan(-1);
    const end = SOURCE.indexOf('export function useFriendCompletions', start);
    expect(end, 'fetchFriendCompletions end marker not found').toBeGreaterThan(start);
    return SOURCE.slice(start, end);
}

function hookBody() {
    const start = SOURCE.indexOf('export function useFriendCompletions');
    expect(start, 'useFriendCompletions not found').toBeGreaterThan(-1);
    const end = SOURCE.indexOf('\nexport ', start + 1);
    expect(end, 'useFriendCompletions end marker not found').toBeGreaterThan(start);
    return SOURCE.slice(start, end);
}

describe('fetchFriendCompletions is pair-scoped', () => {
    it('reads the joint-completion ledger', () => {
        expect(fetchBody()).toContain("from('friend_completions')");
    });

    it('filters by BOTH the viewer and the owner', () => {
        const body = fetchBody();
        expect(body).toMatch(/\.eq\('actor_id',\s*viewerId\)/);
        expect(body).toMatch(/\.eq\('owner_id',\s*ownerId\)/);
        // A missing owner filter would badge a lesson done with a different
        // friend — the exact hole this replaces.
        expect(body.indexOf(".eq('actor_id'")).toBeLessThan(body.indexOf(".eq('owner_id'"));
    });

    it('selects only the lesson keys and maps them to the camelCase view shape', () => {
        const body = fetchBody();
        expect(body).toContain(".select('course_id,lesson_id')");
        expect(body).toMatch(/courseId:\s*row\.course_id/);
        expect(body).toMatch(/lessonId:\s*row\.lesson_id/);
    });

    it('returns [] without a query for a guest or for your own profile', () => {
        const body = fetchBody();
        expect(body).toMatch(/if \(!viewerId \|\| !ownerId \|\| viewerId === ownerId\) return \[\]/);
    });
});

describe('useFriendCompletions', () => {
    it('is gated on a real viewer and a different owner', () => {
        const body = hookBody();
        expect(body).toMatch(/enabled:\s*!!viewerId && !!ownerId && viewerId !== ownerId/);
    });

    it('is fresh on mount so a just-earned badge is not hidden by a cached empty list', () => {
        // The global query default is staleTime: Infinity; the profile is
        // mounted right after the lesson that earned the badge.
        expect(hookBody()).toMatch(/staleTime:\s*0/);
    });

    it('keys the cache by both ids', () => {
        expect(hookBody()).toMatch(/queryKey:\s*\['friend', 'completions', viewerId, ownerId\]/);
    });
});
