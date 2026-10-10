import React from 'react';
import Strings from '../../data/strings.js';
import FriendCoursesView from './FriendCoursesView.jsx';

// Public course-listings page (`/courses`). Purely presentational; the
// container loads the friend courses. Uses plain `<a href>` (not `<Link>`) for
// the course cards so full-page navigation needs no Router context, matching
// the profile page's anchors.
export default function CourseListings({ lang = 'en', courses, isLoading = false, isError = false, onBack }) {
    const containerStyle = {
        minHeight: '100dvh',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
        paddingBottom: '40px',
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <button
                    type="button"
                    data-testid="friend-courses-back"
                    onClick={onBack}
                    style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
                >
                    <i className="bi bi-arrow-left"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('home_courses', lang)}</span>
            </div>

            <FriendCoursesView lang={lang} courses={courses} isLoading={isLoading} isError={isError} />
        </div>
    );
}
