// Pure rules for repairing an incomplete user_profiles row.
import { describe, it, expect } from 'vitest';

import {
    PROFILE_IDENTITY_FIELDS,
    profileNeedsRepair,
    splitFullName,
    buildCompleteProfileRow,
    mergeProfileRow,
} from './profile-repair-logic.js';

// What useUserProfile hands back for each state (api.js).
const coreDataFallback = {           // row missing -> the "core data" branch
    $id: 'u-1',
    email: 'jo@example.com',
    display_name: 'Jo Kim',
    join_date: '2026-10-17T00:00:00Z',
    auth_method: 'supabase',
    profilePictureUrl: 'pic.png',
};
const realRow = {                    // a genuine row
    $id: 'u-1',
    email: 'jo@example.com',
    display_name: 'Jo Kim',
    join_date: '2026-10-17T00:00:00Z',
    share_code: 'abcd',
    account_status: 'active',
    first_name: 'Jo',
    last_name: 'Kim',
};

describe('profileNeedsRepair', () => {
    it('flags the core-data fallback that useUserProfile returns for a missing row', () => {
        expect(profileNeedsRepair(coreDataFallback)).toBe(true);
    });

    it('does not flag a genuine row', () => {
        expect(profileNeedsRepair(realRow)).toBe(false);
    });

    it('accepts the camelCase aliases fromDbRow provides', () => {
        expect(profileNeedsRepair({ ...realRow, share_code: undefined, shareCode: 'wxyz' })).toBe(false);
        expect(profileNeedsRepair({ ...realRow, join_date: undefined, joinDate: '2026-10-17' })).toBe(false);
    });

    it('flags a fragment that is missing any identity field', () => {
        for (const field of PROFILE_IDENTITY_FIELDS) {
            const row = { ...realRow, [field]: null };
            expect(profileNeedsRepair(row), `a row without ${field} must be repaired`).toBe(true);
        }
    });

    it('never treats a guest or an absent user as repairable', () => {
        // There is no account to repair for these, and writing one is what
        // created ghost rows in the first place.
        expect(profileNeedsRepair(null)).toBe(false);
        expect(profileNeedsRepair(undefined)).toBe(false);
        expect(profileNeedsRepair({})).toBe(false);
        expect(profileNeedsRepair('nope')).toBe(false);
        expect(profileNeedsRepair({ ...coreDataFallback, $id: 'guest' })).toBe(false);
        expect(profileNeedsRepair({ ...coreDataFallback, $id: undefined })).toBe(false);
    });
});

describe('splitFullName', () => {
    it('splits on the first space, like migration 009 does', () => {
        expect(splitFullName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
        expect(splitFullName('Ada Byron Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Byron Lovelace' });
    });

    it('handles a single name and odd whitespace', () => {
        expect(splitFullName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
        expect(splitFullName('  Jo   Kim  ')).toEqual({ firstName: 'Jo', lastName: 'Kim' });
        expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
        expect(splitFullName(null)).toEqual({ firstName: '', lastName: '' });
    });
});

describe('buildCompleteProfileRow', () => {
    it('produces a row with every identity field populated', () => {
        const row = buildCompleteProfileRow({
            user: { $id: 'u-1', email: 'jo@example.com', name: 'Jo Kim', $createdAt: '2026-10-17T00:00:00Z', native_language: 'fr' },
            shareCode: 'abcd',
        });
        for (const field of PROFILE_IDENTITY_FIELDS) {
            expect(row[field], `${field} must be set on a repaired row`).toBeTruthy();
        }
        expect(row).toMatchObject({
            id: 'u-1',
            email: 'jo@example.com',
            first_name: 'Jo',
            last_name: 'Kim',
            native_language: 'fr',
            account_status: 'active',
            share_code: 'abcd',
        });
    });

    it('reads native_language from user metadata when the session user lacks it', () => {
        const row = buildCompleteProfileRow({
            user: { $id: 'u-1', email: 'jo@example.com', user_metadata: { full_name: 'Jo Kim', native_language: 'bn' } },
            shareCode: 'abcd',
        });
        expect(row.native_language).toBe('bn');
        expect(row.first_name).toBe('Jo');
    });

    it('leaves english_level null rather than guessing a level', () => {
        // Guessing 'A0' would overwrite a real self-reported level on the next
        // profile write.
        const row = buildCompleteProfileRow({ user: { $id: 'u-1', email: 'a@b.com' }, shareCode: 'abcd' });
        expect(row.english_level).toBeNull();
    });

    it('returns null without a user, so nothing is ever written for a guest', () => {
        expect(buildCompleteProfileRow()).toBeNull();
        expect(buildCompleteProfileRow({ user: null })).toBeNull();
        expect(buildCompleteProfileRow({ user: {} })).toBeNull();
    });
});

describe('mergeProfileRow', () => {
    it('lets the complete row win, so a repair is not undone by the incremental write', () => {
        expect(mergeProfileRow({ email: 'a@b.com', share_code: 'abcd' }, { course_progress: '{}' }))
            .toEqual({ course_progress: '{}', email: 'a@b.com', share_code: 'abcd' });
    });

    it('passes through when either side is absent', () => {
        expect(mergeProfileRow(null, { course_progress: '{}' })).toEqual({ course_progress: '{}' });
        expect(mergeProfileRow({ email: 'a@b.com' }, null)).toEqual({ email: 'a@b.com' });
    });
});