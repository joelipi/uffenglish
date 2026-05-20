// --- modules/useLessonRouter.js ---

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * React hook for lesson routing side effects.
 *
 * Replaces the web-only imperative functions from the old lesson-router.js:
 *   cleanBrowserUrlRoute()  → call cleanRoutingParams() or use the auto-clean option
 *   navigateToLogin()       → goToLogin(redirectUrl)
 *   navigateToHome()        → goToHome()
 *
 * Pure routing logic (resolveCurrentLessonId, resolveCurrentCourseId, etc.)
 * lives in lessonRouting.js and does not need a hook.
 *
 * @param {object} options
 * @param {boolean} [options.autoCleanParams=false] - If true, automatically strips
 *   lessonId/course/courseId from the URL on mount. Pass true in whichever component
 *   is responsible for bootstrapping the lesson (e.g. your top-level lesson loader).
 */
export function useLessonRouter({ autoCleanParams = false } = {}) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Replaces cleanBrowserUrlRoute() — strips routing bootstrap params from the URL
    // after they've been consumed, without causing a page reload.
    useEffect(() => {
        if (!autoCleanParams) return;

        const routingKeys = ['lessonid', 'course', 'courseid'];
        const keysToDelete = [...searchParams.keys()].filter(k =>
            routingKeys.includes(k.toLowerCase())
        );

        if (keysToDelete.length > 0) {
            const next = new URLSearchParams(searchParams);
            keysToDelete.forEach(k => next.delete(k));
            setSearchParams(next, { replace: true });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Intentionally empty deps — this should only run once on mount,
    // same behaviour as the original cleanBrowserUrlRoute() call.

    /**
     * Replaces navigateToLogin().
     * @param {string} redirectUrl - The URL to return to after login.
     */
    const goToLogin = (redirectUrl) => {
        navigate(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
    };

    /**
     * Replaces navigateToHome().
     */
    const goToHome = () => {
        navigate('/home');
    };

    return { goToLogin, goToHome };
}