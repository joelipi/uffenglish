import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

// Every module/component that renders localized text or resolves lesson content
// must go through the single source of truth for the app language
// (`guestNativeLanguage || userData.native_language || 'en'`, AGENTS.md):
// useNativeLanguage() in components, getAppLanguage()/getAppLanguageFor() or
// resolveConfigLanguage() in modules. The async profile bootstrap can write
// the fetched profile's `native_language` ("EN") after a guest picked another
// language, so a bare `userData.native_language` read renders English (lesson
// subtitles, mission, placeholders, warnings) while the rest of the UI is
// localized — the French-lesson regression. The canonical definition itself
// (config-normalizer.js, use-native-language.js) and the store mirror writes
// are the only places allowed to name the field.
const RESOLUTION_FILES = [
    ['src', 'modules', 'answer', 'answers.js'],
    ['src', 'modules', 'lesson', 'lesson-progression.js'],
    ['src', 'modules', 'lesson', 'step-executor-webonly.js'],
    ['src', 'modules', 'lesson', 'step-loader-logic.js'],
    ['src', 'hooks', 'use-initialize-lesson-webonly.js'],
    ['src', 'modules', 'speech', 'speech-orchestrator.js'],
    ['src', 'components', 'chat', 'chat-interface.js'],
    ['src', 'components', 'widgets', 'IntroChoices.jsx'],
    ['src', 'components', 'widgets', 'AuthLink.jsx'],
    ['src', 'components', 'legal', 'LegalPage.jsx'],
    ['src', 'components', 'homescreen', 'HomeScreen.jsx'],
    ['src', 'components', 'homescreen', 'HomeLandingContainer.jsx'],
    ['src', 'components', 'friends', 'Friends.jsx'],
    ['src', 'routes', 'AppLayout.jsx'],
];

// Case-folding only: success-step-logic.js never resolves the language, it
// normalizes the code its caller supplies (uppercase store codes miss the
// lowercase caption keys otherwise). The guest-first decision point for the
// success step is AppLayout.jsx above, which IS in the resolution list — a
// caller passing `userData.native_language` straight through would satisfy
// neither list.
const NORMALIZATION_FILES = [
    ['src', 'modules', 'lesson', 'success-step-logic.js'],
];

const RESOLUTION_APPROVED = /getAppLanguageFor|getAppLanguage|useNativeLanguage|resolveConfigLanguage/;
const NORMALIZATION_APPROVED = /normalizeLanguageCode/;

function assertNoDirectRead(relPath, source) {
    expect(source, `${relPath} reads userData.native_language directly`).not.toMatch(/userData\?\.native_language/);
    expect(source, `${relPath} reads userData.native_language directly`).not.toMatch(/userData\.native_language/);
}

describe('app language resolves through the single source of truth', () => {
    it.each(RESOLUTION_FILES.map((segments) => segments.join('/')))('%s', (relPath) => {
        const source = read(...relPath.split('/'));
        assertNoDirectRead(relPath, source);
        expect(source, `${relPath} bypasses the app-language helpers`).toMatch(RESOLUTION_APPROVED);
    });

    it.each(NORMALIZATION_FILES.map((segments) => segments.join('/')))('%s', (relPath) => {
        const source = read(...relPath.split('/'));
        assertNoDirectRead(relPath, source);
        expect(source, `${relPath} bypasses the language normalizer`).toMatch(NORMALIZATION_APPROVED);
    });
});
