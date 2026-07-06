import { useParams } from 'react-router-dom';
import PublicProfile from '../components/profile/PublicProfile.jsx';
import { usePreloader } from '../hooks/usePreloader.js';
import { useEffect } from 'react';

export default function PublicProfileRoute() {
    const { shortCode } = useParams();
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []);
    return <PublicProfile shortCode={shortCode} />;
}
