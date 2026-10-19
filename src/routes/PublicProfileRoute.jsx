import { useParams } from 'react-router-dom';
import PublicProfile from '../components/profile/PublicProfile.jsx';
import NotFoundRoute from './NotFoundRoute.jsx';
import { isShareCodeSegment, normalizeShareCodeSegment } from '../modules/utils/short-id.js';
import { usePreloader } from '../hooks/usePreloader.js';
import { useEffect } from 'react';

export default function PublicProfileRoute() {
    const { shareCode: rawShareCode } = useParams();
    const { finishPreloader } = usePreloader();
    // Share codes are stored lowercase, so an uppercase or mixed-case link
    // (`/Abcd`) resolves the same code as `/abcd`. Normalize before the shape
    // check and before the lookup.
    const shareCode = normalizeShareCodeSegment(rawShareCode);
    const canBeShareCode = isShareCodeSegment(shareCode);

    // `/:shareCode` claims every single-segment path, so a mistyped path like
    // `/nonsense` would otherwise be reported as a missing person. Only a
    // segment with the generator's own shape (after case normalization) can be
    // a share code; everything else is a 404. A real code — including a
    // mistyped one that still has the shape — keeps the existing "User not
    // found" behaviour below.
    //
    // The preloader is finished by exactly one of the two routes: NotFoundRoute
    // owns the 404 branch, and this effect covers the profile branch. Calling
    // both would start two poster polls (finishPreloader is not re-entrant).
    useEffect(() => { if (canBeShareCode) finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!canBeShareCode) {
        return <NotFoundRoute />;
    }

    return <PublicProfile shareCode={shareCode} />;
}
