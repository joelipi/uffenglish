// modules/courses/friend-course-configs.js
// Loads every `src/config/*.json` for the course-listings page. Vite bundles
// each config JSON as its own lazy chunk, so the configs are NOT pulled into
// the main bundle — they are fetched only when the listings page opens.
// A module whose loader rejects is skipped (never fatal); a single bad config
// must not blank the whole page.

const configModules = import.meta.glob('../../config/*.json');

// `./config/friendchain.json` or `../../config/wouldyourather.json` -> `friendchain`.
export function configCourseId(path) {
    return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

/**
 * Resolve every config module to `{ courseId, config }`.
 * @param {Record<string, () => Promise<any>>} modules - injectable for tests
 * @returns {Promise<Array<{ courseId: string, config: object }>>}
 */
export async function loadConfigEntries(modules = configModules) {
    const entries = await Promise.all(
        Object.entries(modules).map(async ([path, load]) => {
            try {
                const mod = await load();
                return { courseId: configCourseId(path), config: mod?.default ?? mod };
            } catch (error) {
                console.error('[friend-courses] Failed to load config', path, error);
                return null;
            }
        })
    );
    return entries.filter(Boolean);
}
