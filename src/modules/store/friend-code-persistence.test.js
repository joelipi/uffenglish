// src/modules/store/friend-code-persistence.test.js
// Story 033: friendCode is a live mirror of the current URL (?shareCode=), set
// by RootLayout. It must not hydrate from localStorage, and any legacy
// persisted value must be stripped by a persist version/migrate bump.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STORAGE_KEY = 'uff-lesson-storage';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_SOURCE = readFileSync(path.join(__dirname, 'store.js'), 'utf8');

// The partialize object literal (no nested braces) so a source guard can prove
// friendCode is not among the persisted keys — the rest of the file legitimately
// mentions friendCode in the state, setter and migrate.
function partializeBlock(source) {
    const start = source.indexOf('partialize:');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n            })', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

const importStore = () => import('./store.js');

describe('friendCode persistence (story 033)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('bumps persist to version 1 with a migrate that drops friendCode', () => {
        expect(STORE_SOURCE).toContain('version: 1');
        expect(STORE_SOURCE).toMatch(/migrate\s*:\s*\(persistedState\)/);
        expect(STORE_SOURCE).toMatch(
            /const\s*\{\s*friendCode\s*,\s*\.\.\.rest\s*\}\s*=\s*persistedState/
        );
    });

    it('does not include friendCode in the partialize object', () => {
        expect(partializeBlock(STORE_SOURCE)).not.toContain('friendCode');
    });

    it('defaults friendCode to null when there is no persisted blob', async () => {
        const { appStore } = await importStore();
        expect(appStore.getState().friendCode).toBeNull();
    });

    it('strips a legacy persisted friendCode but keeps other persisted keys', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            state: { friendCode: 'stale', courseId: 'friend' },
            version: 0,
        }));

        const { appStore } = await importStore();
        expect(appStore.getState().friendCode).toBeNull();
        expect(appStore.getState().courseId).toBe('friend');
    });

    it('never writes friendCode back to localStorage', async () => {
        const { appStore } = await importStore();
        appStore.getState().setFriendCode('stale');

        const written = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(written.state.friendCode).toBeUndefined();
        expect(written.version).toBe(1);
    });
});
