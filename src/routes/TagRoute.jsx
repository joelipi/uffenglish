import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import TagPageContainer from '../components/courses/TagPageContainer.jsx';

// A tag page: the courses that carry one tag. An inside page of the app, so
// it renders inside the app shell (the shared header).
export default function TagRoute() {
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <TagPageContainer />;
}
