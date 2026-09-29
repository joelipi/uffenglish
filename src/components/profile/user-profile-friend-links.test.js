// src/components/profile/user-profile-friend-links.test.js
// Source guard for the signed-in owner's profile surface (story 026). The page
// itself pulls in the full Supabase/api graph, so its component behavior is not
// imported here; the shared FriendLessonLinksSection behavior is covered by
// FriendLessonLinksSection.test.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('UserProfile friend-links surface', () => {
    const source = stripComments(readFileSync(path.join(ROOT, 'src/components/profile/UserProfile.jsx'), 'utf8'));

    it('imports FriendLessonLinksSection from the section module', () => {
        expect(source).toContain("import FriendLessonLinksSection from './FriendLessonLinksSection.jsx'");
    });

    it('renders the section with a friendLinks prop', () => {
        expect(source).toContain('<FriendLessonLinksSection friendLinks=');
        expect(source).toMatch(/<FriendLessonLinksSection\s+friendLinks=\{profile\?\.friendLinks\}/);
    });
});
