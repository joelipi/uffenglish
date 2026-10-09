import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard: the guest-modal guard must skip the public homepage and must
// not burn `guestModalShownThisSession` there, so the modal still opens on the
// next non-auth route (the share-code lesson/profile). The effect depends on
// react-router + react-query + Supabase, so this locks the wiring by source.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'use-guest-modal-guard.js'), 'utf8');

// Scope the slice to the "open modal for non-auth guests" effect body, ending
// at its dependency array. Never slice to EOF — a function appended later would
// silently join the slice.
const blockStart = src.indexOf('if (!isAuthRoute) {');
const blockEnd = src.indexOf('}, [isLoading, isLoggedIn, location.pathname, location.search]);');
const block = src.slice(blockStart, blockEnd);

describe('guest-modal guard public-homepage skip', () => {
    it('finds the non-auth guest-modal block', () => {
        expect(blockStart).toBeGreaterThan(-1);
        expect(blockEnd).toBeGreaterThan(blockStart);
    });

    it('calls isPublicHomeRoute(path) in the guard block', () => {
        expect(block).toContain('isPublicHomeRoute(path)');
    });

    it('returns early for the public homepage before setting the session flag', () => {
        const publicAt = block.indexOf('isPublicHomeRoute(path)');
        const flagAt = block.indexOf('state.setGuestModalShownThisSession(true)');
        expect(publicAt).toBeGreaterThan(-1);
        expect(flagAt).toBeGreaterThan(-1);
        expect(publicAt).toBeLessThan(flagAt);
    });

    it('does not call setGuestModalShownThisSession in the public-homepage early return', () => {
        const publicAt = block.indexOf('isPublicHomeRoute(path)');
        // The early return is the return statement immediately following the
        // predicate; slice up to it and assert the flag is not set there.
        const returnAt = block.indexOf('return;', publicAt);
        const earlyReturn = block.slice(publicAt, returnAt + 'return;'.length);
        expect(earlyReturn).toContain('return;');
        expect(earlyReturn).not.toContain('setGuestModalShownThisSession');
    });
});

describe('guest-modal guard profile-route skip', () => {
    it('calls isProfileRoute(path) in the guard block', () => {
        expect(block).toContain('isProfileRoute(path)');
    });

    it('returns early for profile routes before setting the session flag', () => {
        const profileAt = block.indexOf('isProfileRoute(path)');
        const flagAt = block.indexOf('state.setGuestModalShownThisSession(true)');
        expect(profileAt).toBeGreaterThan(-1);
        expect(flagAt).toBeGreaterThan(-1);
        expect(profileAt).toBeLessThan(flagAt);
    });

    it('does not call setGuestModalShownThisSession in the profile-route early return', () => {
        const profileAt = block.indexOf('isProfileRoute(path)');
        const returnAt = block.indexOf('return;', profileAt);
        const earlyReturn = block.slice(profileAt, returnAt + 'return;'.length);
        expect(earlyReturn).toContain('return;');
        expect(earlyReturn).not.toContain('setGuestModalShownThisSession');
    });
});
