// Guards the profile statistics rows: streak, total lessons, friend count,
// referrals (plus the pre-existing days-active row) on both the private
// profile and the public share-code page. The rows are inline JSX computed
// from the profile object, so these assert the wiring contract on raw source:
// the string key rendered, the profile field read, and the streak derived via
// calculateCurrentStreak (never a raw field). Assert on raw source only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { get, strings } from '../../data/strings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userProfileSource = readFileSync(path.join(__dirname, 'UserProfile.jsx'), 'utf8');
const publicProfileSource = readFileSync(path.join(__dirname, 'PublicProfile.jsx'), 'utf8');

describe.each([
    ['UserProfile.jsx', userProfileSource],
    ['PublicProfile.jsx', publicProfileSource],
])('%s statistics rows', (_name, source) => {
    it.each(['profile_streak', 'profile_lessons_completed', 'profile_friend_count', 'profile_referrals', 'profile_days_active'])(
        'renders the %s row', (key) => {
            expect(source).toContain(`Strings.get('${key}'`);
        }
    );

    it('derives the streak via calculateCurrentStreak, not a stored field', () => {
        expect(source).toContain('calculateCurrentStreak');
        expect(source).toContain('calculateCurrentStreak(completedDates)');
    });

    it('reads the friend count from the profile friends array', () => {
        expect(source).toContain('.friends');
        expect(source).toContain('friendCount');
    });

    it('reads referrals from the profile row', () => {
        expect(source).toContain('.referrals');
    });
});

describe('profile statistics labels', () => {
    it.each([
        ['profile_streak', 'Streak'],
        ['profile_friend_count', 'Friends'],
        ['profile_referrals', 'Referrals'],
    ])('%s has the exact English label', (key, en) => {
        expect(strings[key].en).toBe(en);
    });

    it.each(['profile_streak', 'profile_friend_count', 'profile_referrals'])(
        '%s carries es/pt/fr/hi/bn values', (key) => {
            for (const lang of ['es', 'pt', 'fr', 'hi', 'bn']) {
                expect(strings[key][lang], `${key}/${lang}`).toBeTruthy();
            }
            expect(get(`missing_${key}`, 'en')).toBe(`missing_${key}`);
        }
    );
});
