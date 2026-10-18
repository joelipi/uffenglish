import { useParams } from 'react-router-dom';
import PublicProfile from '../components/profile/PublicProfile.jsx';
import NotFoundRoute from './NotFoundRoute.jsx';
import { isShareCodeSegment } from '../modules/utils/short-id.js';
import { usePreloader } from '../hooks/usePreloader.js';
import { useEffect } from 'react';

export default function PublicProfileRoute() {
    const { shareCode } = useParams();
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []);

    // `/:shareCode` claims every single-segment path, so a mistyped path like
    // `/nonsense` would otherwise be reported as a missing person. Only a
    // segment with the generator's own shape can be a share code; everything
    // else is a 404. A real code (including a mistyped one that still has the
    // shape) keeps the existing "User not found" behaviour below.
    if (!isShareCodeSegment(shareCode)) {
        return <NotFoundRoute />;
    }

    return <PublicProfile shareCode={shareCode} />;
}
