import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import CourseListingsContainer from '../components/courses/CourseListingsContainer.jsx';

export default function CoursesRoute() {
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <CourseListingsContainer />;
}
