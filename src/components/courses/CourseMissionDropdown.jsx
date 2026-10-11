import React, { useState } from 'react';
import { BilingualText } from '../BilingualText.jsx';
import { COURSE_MISSION_FALLBACK_KEYS } from '../../modules/courses/friend-courses-logic.js';

const ROW_ICONS = {
    mission: 'bi-bullseye',
    setting: 'bi-geo-alt',
    roleUser: 'bi-person',
    roleOther: 'bi-people',
};

const ROW_TEXT_CLASSES = {
    mission: 'mission-text',
    setting: 'setting-text',
    roleUser: 'roleUser-text',
    roleOther: 'roleOther-text',
};

function orderedKeys(mission) {
    const keys = Object.keys(mission);
    return [
        ...COURSE_MISSION_FALLBACK_KEYS.filter((key) => keys.includes(key)),
        ...keys.filter((key) => !COURSE_MISSION_FALLBACK_KEYS.includes(key)),
    ];
}

export default function CourseMissionDropdown({ lang = 'en', mission }) {
    const [expanded, setExpanded] = useState(false);

    if (!mission || typeof mission !== 'object' || Object.keys(mission).length === 0) return null;

    function toggle(e) {
        e.preventDefault();
        setExpanded((prev) => !prev);
    }

    return (
        <div
            className={'mission-section' + (expanded ? ' expanded' : '')}
            data-testid="course-mission"
            onClick={toggle}
            style={{ marginTop: '12px' }}
        >
            <div className="mission-row text-shadow">
                <div className="d-flex align-items-center flex-grow-1 overflow-hidden">
                    {orderedKeys(mission).map((key) => (
                        <React.Fragment key={key}>
                            <span className="mission-label"><i className={'bi ' + (ROW_ICONS[key] || 'bi-info-circle')}></i></span>
                            <span className={ROW_TEXT_CLASSES[key] || 'course-meta-text'}><BilingualText translationData={mission[key]} userLang={lang} spanPrefix=" " /></span>
                        </React.Fragment>
                    ))}
                </div>
                <div className="mission-toggle-icon">
                    <i className={'bi ' + (expanded ? 'bi-chevron-up' : 'bi-chevron-down')}></i>
                </div>
            </div>
        </div>
    );
}
