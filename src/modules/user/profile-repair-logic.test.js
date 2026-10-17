// Pure rules for repairing an incomplete user_profiles row.
//
// The contract that matters: a repair may only FILL absent fields. It must never
// clear a streak, null a self-reported level, or rotate a published share code.
import { describe, it, expect } from 'vitest';

import {
    PROFILE_IDENTITY_FIELDS,
    profileIsIncomplete,
    splitFullName,
    planProfileRepair,
} from './profile-repair-logic.js';

const sessionUser = {
    $id: 'u-1',
    email: 'jo@example.com',
    name: 'Jo Kim',
    $createdAt: '2026-10-17T00:00:00Z',
    user_metadata: { native_language: 'fr' },
};

const completeRow = {
    id: 'u-1',
    email: 'jo@example.com',
    first_name: 'Jo',
    last_name: 'Kim',
    share_code: 'abcd',
    join_date: '2026-10-17T00:00:00Z',
    account_status: 'active',
    native_language: 'fr',
};

describe('profileIsIncomplete', () => {
    it('is false for a complete row and for no row', () => {
        expect(profileIsIncomplete(completeRow)).toBe(false);
        expect(profileIsIncomplete(null)).toBe(false);
    });

    it('is true when any identity column is absent or NULL', () => {
        for (const field of PROFILE_IDENTITY_FIELDS) {
            expect(profileIsIncomplete({ ...completeRow, [field]: null }),
                `a row with a NULL ${field} is a fragment`).toBe(true);
            expect(profileIsIncomplete({ ...completeRow, [field]: '' }),
                `a row with an empty ${field} is a fragment`).toBe(true);
        }
    });
});

describe('splitFullName', () => {
    it('splits on the first whitespace run, like migration 009 splits on a space', () => {
        expect(splitFullName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
        expect(splitFullName('Ada Byron Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Byron Lovelace' });
    });

    it('handles a single name, stray whitespace and non-strings', () => {
        expect(splitFullName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
        expect(splitFullName('  Jo   Kim  ')).toEqual({ firstName: 'Jo', lastName: 'Kim' });
        expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
        expect(splitFullName(null)).toEqual({ firstName: '', lastName: '' });
    });
});

describe('planProfileRepair', () => {
    it('does nothing for a guest or an absent user', () => {
        expect(planProfileRepair({ row: null, user: null })).toEqual({ action: 'none' });
        expect(planProfileRepair({ row: null, user: { $id: 'guest' } })).toEqual({ action: 'none' });
        expect(planProfileRepair()).toEqual({ action: 'none' });
    });

    it('does nothing when the row is already complete', () => {
        expect(planProfileRepair({ row: completeRow, user: sessionUser })).toEqual({ action: 'none' });
    });

    describe('when no row exists', () => {
        it('plans a full insert', () => {
            const plan = planProfileRepair({ row: null, user: sessionUser });
            expect(plan.action).toBe('insert');
            expect(plan.payload).toMatchObject({
                id: 'u-1',
                email: 'jo@example.com',
                first_name: 'Jo',
                last_name: 'Kim',
                account_status: 'active',
                native_language: 'fr',
            });
            // Null until the caller assigns one; there is no existing code to protect.
            expect(plan.payload.share_code).toBeNull();
        });

        it('never invents an english level', () => {
            const plan = planProfileRepair({ row: null, user: sessionUser });
            expect('english_level' in plan.payload).toBe(false);
        });
    });

    describe('when a fragment row exists', () => {
        const ghost = {
            id: 'u-1',
            email: null,
            first_name: null,
            last_name: null,
            share_code: null,
            join_date: null,
            account_status: 'active',
            native_language: null,
        };

        it('fills only the missing identity fields', () => {
            const plan = planProfileRepair({ row: ghost, user: sessionUser, shareCode: 'newcode' });
            expect(plan.action).toBe('update');
            expect(plan.payload).toEqual({
                id: 'u-1',
                email: 'jo@example.com',
                join_date: '2026-10-17T00:00:00Z',
                first_name: 'Jo',
                last_name: 'Kim',
                native_language: 'fr',
                share_code: 'newcode',
            });
        });

        it('omits share_code when the caller supplies none', () => {
            // Distinct from the rotation guard below: here the row has no code and
            // no candidate was offered, so nothing can be filled.
            const plan = planProfileRepair({ row: ghost, user: sessionUser });
            expect('share_code' in plan.payload).toBe(false);
        });

        it('NEVER overwrites fields the row already has', () => {
            const partial = {
                id: 'u-1',
                email: 'real@example.com',
                share_code: 'keepme',
                join_date: '2026-01-01T00:00:00Z',
                account_status: 'active',
                native_language: 'bn',
                first_name: 'Real',
                last_name: 'Name',
            };
            // Nothing is missing here: a complete row must never be rewritten.
            expect(planProfileRepair({ row: partial, user: sessionUser })).toEqual({ action: 'none' });

            const missingStatus = { ...partial, account_status: null };
            const plan = planProfileRepair({ row: missingStatus, user: sessionUser });
            expect(plan.payload).toEqual({ id: 'u-1', account_status: 'active' });
            expect(plan.payload.email).toBeUndefined();
            expect(plan.payload.share_code).toBeUndefined();
            expect(plan.payload.first_name).toBeUndefined();
        });

        it('does not clobber completed_dates or english_level, which are not in the payload', () => {
            const withProgress = { ...ghost, completed_dates: ['2026-10-01'], english_level: 'B1' };
            const plan = planProfileRepair({ row: withProgress, user: sessionUser });
            expect('completed_dates' in plan.payload).toBe(false);
            expect('english_level' in plan.payload).toBe(false);
        });

        it('fills a NULL share code — there is nothing to protect', () => {
            // Regression: refusing here left the target accounts permanently
            // "incomplete", so the caller's guard blocked every future write and
            // they never got a share code at all. The column is UNIQUE, so a NULL
            // cannot hide a previously published code.
            const onlyCodeMissing = { ...completeRow, share_code: null };
            const plan = planProfileRepair({ row: onlyCodeMissing, user: sessionUser, shareCode: 'newcode' });
            expect(plan.action).toBe('update');
            expect(plan.payload).toEqual({ id: 'u-1', share_code: 'newcode' });
        });

        it('omits share_code entirely when the caller supplied none', () => {
            const onlyCodeMissing = { ...completeRow, share_code: null };
            expect(planProfileRepair({ row: onlyCodeMissing, user: sessionUser }))
                .toEqual({ action: 'none' });
        });

        it('NEVER overwrites an existing share code — the rotation guard', () => {
            // The real rotation guard: a code already published to R2 and printed
            // in share links must survive a repair untouched, even when the
            // caller supplies a replacement.
            const plan = planProfileRepair({
                row: { ...completeRow, share_code: 'published', email: null },
                user: sessionUser,
                shareCode: 'newcode',
            });
            expect(plan.payload.share_code).toBeUndefined();
            expect('share_code' in plan.payload).toBe(false);
        });
    });
});
