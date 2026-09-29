// src/App.friend-code.test.js
// Story 033: the mount-only share-code capture was removed from App.jsx;
// RootLayout is now the sole URL-driven writer of appStore.friendCode.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_SOURCE = readFileSync(path.join(__dirname, 'App.jsx'), 'utf8');
const ROOT_SOURCE = readFileSync(path.join(__dirname, 'routes/RootLayout.jsx'), 'utf8');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('App.jsx friendCode capture removal (story 033)', () => {
    it('no longer parses URLSearchParams or sets friendCode', () => {
        const source = stripComments(APP_SOURCE);
        expect(source).not.toContain('URLSearchParams');
        expect(source).not.toContain('setFriendCode');
    });

    it('keeps the deferred PostHog import effect and the useEffect import', () => {
        const source = stripComments(APP_SOURCE);
        expect(source).toMatch(/import\s+(?:React\s*,\s*)?\{[^}]*useEffect[^}]*\}\s*from\s*'react'/);
        expect(source).toContain("import('./modules/utils/posthog-client.js')");
    });

    it('leaves RootLayout as the sole URL-driven writer of friendCode', () => {
        expect(stripComments(ROOT_SOURCE)).toContain('setFriendCode(');
    });
});
