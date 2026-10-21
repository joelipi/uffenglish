// Capture the friend's share code from the URL query.
//
// The code identifies the learner whose clip the lesson must play, so it has
// to be in the store before the lesson resolves its video source.
//
// It is captured on EVERY location change, not once at start-up: the profile's
// friend-practice link is a CLIENT-SIDE navigation (react-router's <Link>),
// so the app is already mounted when the visitor clicks it and a one-shot
// start-up capture would miss the code entirely.
//
// A code is never CLEARED here. The lesson advances to the next lesson with a
// client-side navigation that carries no query string
// (`navigate('/course/<id>/lesson/<next>')`), so clearing on a missing code
// would drop the friend clip the moment the learner moves on. The code that
// brought them in is the code that stays.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { appStore } from '../modules/store/store.js';
import { getShareCodeFromSearch } from '../modules/user/friend-lesson-detection.js';

/**
 * Read `?shareCode=` from the current location and keep the store in sync.
 *
 * @returns {string|null} the code found in the current query string, or null
 */
export function useShareCodeFromLocation() {
    const location = useLocation();
    const shareCode = getShareCodeFromSearch(location.search);

    useEffect(() => {
        if (!shareCode) return;
        appStore.getState().setFriendCode(shareCode);
        console.log('[React] Captured sharecode param:', shareCode);
    }, [shareCode]);

    return shareCode;
}
