import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

// Components that localize visible text must resolve the active language
// guest-first (agents.md:11). The async profile bootstrap can write the fetched
// profile's native_language ("EN") after a guest picked Bengali, so reading
// `userData.native_language` alone left the recap CTA and Share label in English
// while the rest of the app was Bengali (story 023 regression). They must use
// useNativeLanguage() / the guest-first expression instead.
const LOCALIZING_COMPONENTS = [
    ['widgets', 'SuccessScreen.jsx'],
    ['widgets', 'SuccessButtons.jsx'],
    ['widgets', 'DecisionButtons.jsx'],
    ['widgets', 'Hints.jsx'],
    ['widgets', 'ViewAndContinueButtons.jsx'],
    ['widgets', 'MissionSection.jsx'],
    ['widgets', 'LandscapeWarning.web.jsx'],
    ['chat', 'ContinueWidgetBubble.jsx'],
    ['SimpleVideoPlayer.web.jsx'],
    ['InteractiveVideoPlayer.web.jsx'],
    ['LessonContainer.jsx'],
];

describe('localizing components resolve the active language guest-first', () => {
    it.each(LOCALIZING_COMPONENTS)('%s/%s', (...segments) => {
        const source = read(...segments);
        expect(source).not.toMatch(/userData\?\.native_language/);
        expect(source).toMatch(/useNativeLanguage/);
    });
});
