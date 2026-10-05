import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import HomeLandingContainer from '../components/homescreen/HomeLandingContainer.jsx';

export default function PublicHomeRoute() {
    const { finishPreloader } = usePreloader();

    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <HomeLandingContainer />;
}
