import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the guest-modal guard/modal/store wiring. The guard, the
// React modal, and the browser language cannot be exercised in vitest, so this
// locks the contract that friend detection is gated behind the logged-in early
// return, the silent-adopt path is wired, and the store actions exist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const guard = read('../../hooks/use-guest-modal-guard.js');
const modal = read('../../components/modals/GuestLoginModal.web.jsx');
const store = read('../store/store.js');

describe('useGuestModalGuard wiring', () => {
    it('keeps the logged-in early return before any friend detection', () => {
        const earlyReturn = guard.indexOf('if (isLoading || isLoggedIn) return;');
        const friendDetection = guard.indexOf('isFriendLesson(');
        expect(earlyReturn).toBeGreaterThanOrEqual(0);
        expect(friendDetection).toBeGreaterThanOrEqual(0);
        expect(earlyReturn).toBeLessThan(friendDetection);
    });

    it('imports the detection + decision helpers', () => {
        expect(guard).toContain("from '../modules/user/friend-lesson-detection.js'");
        expect(guard).toContain('isFriendLesson');
        expect(guard).toContain("from '../modules/user/guest-modal-logic.js'");
        expect(guard).toContain('resolveGuestModalPlan');
    });

    it('detects a friend lesson from search + pathname and resolves a plan', () => {
        expect(guard).toContain('isFriendLesson({ search: location.search, pathname: path })');
        expect(guard).toContain('resolveGuestModalPlan({');
    });

    it('adopts the language silently inside the adopt-silently branch', () => {
        const branch = guard.indexOf("plan.action === 'adopt-silently'");
        const adopt = guard.indexOf('setGuestLanguageSilent(plan.language)');
        expect(branch).toBeGreaterThanOrEqual(0);
        expect(adopt).toBeGreaterThan(branch);
    });

    it('subscribes to store userData and re-applies the remembered language', () => {
        expect(guard).toContain('useStore(appStore');
        expect(guard).toContain('silentLangRef');
        expect(guard).toContain('setGuestLanguageSilent(decision.language)');
    });

    // Structural guard only: the forget/apply behavior itself is unit-tested in
    // guest-modal-logic.test.js via resolveSilentLanguageReapply.
    it('delegates the re-apply decision to the shared pure helper', () => {
        expect(guard).toContain('resolveSilentLanguageReapply');
        expect(guard).toContain('silentLangRef.current = null;');
    });
});

describe('GuestLoginModal wiring', () => {
    it('confirms the language through confirmGuestLanguage only', () => {
        expect(modal).toContain('confirmGuestLanguage');
        expect(modal).not.toContain('setGuestLanguageAndAdvance');
    });
});

describe('store wiring', () => {
    it('exposes the friend-mode + silent-language + confirm actions', () => {
        expect(store).toContain('guestModalFriendMode');
        expect(store).toContain('setGuestModalFriendMode:');
        expect(store).toContain('setGuestLanguageSilent:');
        expect(store).toContain('confirmGuestLanguage:');
    });

    it('removes the replaced setGuestLanguageAndAdvance action', () => {
        expect(store).not.toContain('setGuestLanguageAndAdvance:');
    });
});
