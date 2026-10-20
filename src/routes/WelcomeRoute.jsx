import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import WelcomePageContainer from '../components/courses/WelcomePageContainer.jsx';

// The welcome page: where "start without a friend's code" lands. An inside
// page of the app, so it renders inside the app shell (the shared header).
export default function WelcomeRoute() {
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <WelcomePageContainer />;
}
