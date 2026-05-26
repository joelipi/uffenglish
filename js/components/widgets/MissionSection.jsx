import React, { useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { BilingualText } from '../BilingualText.jsx';

export default function MissionSection() {
    const [expanded, setExpanded] = useState(false);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const userData = useStore(appStore, (state) => state.userData);

    const lesson = configData?.lessons?.[currentLessonIndex];
    if (!lesson) return null;

    const lang = userData?.native_language || 'en';
    const toggle = () => setExpanded((prev) => !prev);

    return (
        <div
            className={'mission-section' + (expanded ? ' expanded' : '')}
            onClick={toggle}
        >
            <div className="mission-row text-shadow">
                <div className="d-flex align-items-baseline flex-grow-1 overflow-hidden">
                    <span className="mission-label">Mission</span>
                    <span className="mission-text"><BilingualText translationData={lesson.mission} userLang={lang} spanPrefix="/ " /></span>
                    <span className="mission-label">Where</span>
                    <span className="setting-text"><BilingualText translationData={lesson.setting} userLang={lang} spanPrefix="/ " /></span>
                    <span className="mission-label">You are</span>
                    <span className="roleUser-text"><BilingualText translationData={lesson.roleUser} userLang={lang} spanPrefix="/ " /></span>
                    <span className="mission-label">Talking to</span>
                    <span className="roleOther-text"><BilingualText translationData={lesson.roleOther} userLang={lang} spanPrefix="/ " /></span>
                </div>
                <div className="mission-toggle-icon">
                    <i className={'bi ' + (expanded ? 'bi-chevron-down' : 'bi-chevron-up')} id="mission-carat"></i>
                </div>
            </div>
        </div>
    );
}
