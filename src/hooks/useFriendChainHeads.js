import { useQuery } from '@tanstack/react-query';
import { buildChainHeads, listFriendCourseIds } from '../modules/user/friend-lesson-link-logic.js';

// Stable empty map so the section's `chainHeads` prop does not change identity
// on every render when nothing is loaded.
const EMPTY_CHAIN_HEADS = new Map();

// Fetch a single course config the way AppLayout does (same `/src/config/`
// asset, same per-course URL/query cache). A failed or missing config resolves
// to null; the caller then omits that course, and the read-time filter fails
// open for it (the entry is kept rather than hidden).
async function fetchCourseConfig(courseId) {
    try {
        const res = await fetch(`/src/config/${courseId}.json`);
        if (!res.ok) return null;
        return { courseId, config: await res.json() };
    } catch (error) {
        console.error('[friend-chain-heads] Failed to load config', courseId, error);
        return null;
    }
}

/**
 * Map<courseId, firstLessonId> for the courses referenced by `friendLinks`.
 * Fetches ONLY those configs (never the whole config glob), so the public
 * profile does not pull every course into the browser. Returns an empty Map
 * while loading, when there are no links, or when no config resolves.
 */
export default function useFriendChainHeads(friendLinks) {
    const courseIds = listFriendCourseIds(friendLinks);
    const { data } = useQuery({
        queryKey: ['friend-chain-heads', courseIds.join('|')],
        enabled: courseIds.length > 0,
        staleTime: Infinity,
        queryFn: async () => {
            const entries = await Promise.all(courseIds.map(fetchCourseConfig));
            return buildChainHeads(entries.filter(Boolean));
        },
    });
    return data instanceof Map ? data : EMPTY_CHAIN_HEADS;
}
