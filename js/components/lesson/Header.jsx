import React from 'react';
import ActivityStats from '../widgets/ActivityStats.jsx';
import ProgressBar from '../widgets/ProgressBar.jsx';

export default function Header() {
    return (
        <div className="react-lesson-header">
            <ProgressBar />
            <ActivityStats />
        </div>
    );
}
