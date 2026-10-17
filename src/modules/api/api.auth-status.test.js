// Regression guard: "am I signed in?" must not be answered by a network call.
//
// useAuthStatus used to call getCurrentUser() — supabase.auth.getUser(), a
// round-trip to the auth server — which returns null when the request FAILS as
// well as when there is no session. A transient hiccup therefore reported a
// signed-in visitor as signed out.
//
// That was reachable immediately after signup: the fire-and-forget geo/referrer
// collector completes about a second later and calls invalidateUserAndAuthCache
// (), which invalidates ['auth','status'] — so the refetch races the first paint
// of the page the user was just redirected to, and a hiccup there looks exactly
// like "my account did not stick".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'api.js'), 'utf8');

/** The body of useAuthStatus, bounded at its own closing brace. */
function useAuthStatusBody() {
    const start = SOURCE.indexOf('export function useAuthStatus()');
    expect(start, 'useAuthStatus not found').toBeGreaterThan(-1);
    const end = SOURCE.indexOf('\n}', start);
    expect(end, 'could not bound the useAuthStatus body').toBeGreaterThan(start);
    return SOURCE.slice(start, end);
}

describe('useAuthStatus answers from the local session', () => {
    it('never makes a server call', () => {
        const body = useAuthStatusBody();
        // The whole point: no server round-trip inside the auth-status query.
        expect(body, 'auth status must not call getCurrentUser')
            .not.toMatch(/getCurrentUser\s*\(/);
        expect(body, 'auth status must not call auth.getUser')
            .not.toMatch(/auth\.getUser\s*\(/);
    });

    it('reads the persisted session instead', () => {
        expect(useAuthStatusBody()).toMatch(/getCurrentSession\s*\(/);
    });

    it('keeps getCurrentUser for callers that need the server view', () => {
        // The fix must not remove the server read where it is actually needed:
        // getUserProfile and useUserProfile both depend on it.
        expect(SOURCE).toMatch(/getCurrentUser\s*\(\s*\)/);
    });

    it('still reads the same query key, so signup and sign-out stay wired to it', () => {
        // Changing the key would silently orphan the setQueryData(true) that
        // signup writes and the invalidation that sign-out triggers.
        expect(useAuthStatusBody()).toMatch(/queryKey:\s*\['auth',\s*'status'\]/);
        expect(SOURCE).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['auth',\s*'status'\]/);

        const dir = path.dirname(fileURLToPath(import.meta.url));
        const signup = readFileSync(
            path.join(dir, '../../components/auth/SignupForm.jsx'), 'utf8');
        expect(signup, 'signup must still seed the auth-status query')
            .toMatch(/setQueryData\(\['auth',\s*'status'\],\s*true\)/);
    });
});