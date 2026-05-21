import React from 'react';
import { createPortal } from 'react-dom';
import ActivityStats from '../widgets/ActivityStats.jsx';
import ProgressBar from '../widgets/ProgressBar.jsx';

export default function Header() {
    const activityRootEl = document.getElementById('react-root-activity');

    return (
        <div className="react-lesson-header">
            <ProgressBar />
            {activityRootEl && createPortal(<ActivityStats />, activityRootEl)}
        </div>
    );
}
