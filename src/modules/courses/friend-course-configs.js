// modules/courses/friend-course-configs.js
// Loads every `src/config/*.json` for the course-listings page. Vite bundles
// each config JSON as its own lazy chunk, so the configs are NOT pulled into
// the main bundle — they are fetched only when the listings page opens.
// A module whose loader rejects is skipped (never fatal); a single bad config
// must not blank the whole page.
//
// Course hero images also resolve here: a config's `courseHeroImage` is either
// a deployable URL (absolute http(s) or root path, e.g. future R2 media —
// passed through) or a source-tree asset reference resolved by basename
// against the Vite-bundled `src/assets/img/` files (committed imagery, so the
// no-media-under-public/ guard stays green and the URL works in dev and prod).

const configModules = import.meta.glob('../../config/*.json');

// Eager `?url` imports: basename -> bundled URL. Most of these images are
// already in the bundle via direct imports elsewhere, so this adds no weight.
const heroModules = import.meta.glob('../../assets/img/*', { eager: true, query: '?url', import: 'default' });

// `./config/friendchain.json` or `../../config/wouldyourather.json` -> `friendchain`.
export function configCourseId(path) {
    return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

/**
 * Resolve a config `courseHeroImage` reference to a renderable image URL.
 * Absolute http(s) and root-path URLs pass through (deployable media);
 * anything else matches by basename against the bundled `src/assets/img/`
 * files, so the config may name the source path (`src/assets/img/x.jpg`) and
 * still survive the file moving. Unknown basenames resolve to null (no
 * banner) instead of a broken image.
 * @param {unknown} ref - the raw `courseHeroImage` value
 * @returns {string|null}
 */
export function resolveCourseHeroImage(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') return null;
    if (/^https?:\/\//i.test(ref) || ref.startsWith('/')) return ref;
    const base = ref.split('/').pop();
    for (const [path, url] of Object.entries(heroModules)) {
        if (path.split('/').pop() === base && typeof url === 'string') return url;
    }
    return null;
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
