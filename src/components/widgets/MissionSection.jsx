import React, { useState, useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { BilingualText } from '../BilingualText.jsx';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function MissionSection({ responseType }) {
    const [expanded, setExpanded] = useState(responseType === 'lessonIntro');

    useEffect(() => {
        setExpanded(responseType === 'lessonIntro');
    }, [responseType]);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const showMission = useStore(appStore, (state) => state.showMission);
    const lang = useNativeLanguage();

    const lesson = configData?.lessons?.[currentLessonIndex];
    if (!lesson || !showMission) return null;

    const toggle = () => setExpanded((prev) => !prev);

    return (
        <div
            className={'mission-section' + (expanded ? ' expanded' : '')}
            onClick={toggle}
        >
            <div className="mission-row text-shadow">
                <div className="d-flex align-items-center flex-grow-1 overflow-hidden">
                    {lesson.mission && (
                        <>
                            <span className="mission-label"><i className="bi bi-bullseye"></i></span>
                            <span className="mission-text"><BilingualText translationData={lesson.mission} userLang={lang} spanPrefix=" " /></span>
                        </>
                    )}
                    {lesson.setting && (
                        <>
                            <span className="mission-label"><i className="bi bi-geo-alt"></i></span>
                            <span className="setting-text"><BilingualText translationData={lesson.setting} userLang={lang} spanPrefix=" " /></span>
                        </>
                    )}
                    {lesson.roleUser && (
                        <>
                            <span className="mission-label"><i className="bi bi-person"></i></span>
                            <span className="roleUser-text"><BilingualText translationData={lesson.roleUser} userLang={lang} spanPrefix=" " /></span>
                        </>
                    )}
                    {lesson.roleOther && (
                        <>
                            <span className="mission-label"><i className="bi bi-people"></i></span>
                            <span className="roleOther-text"><BilingualText translationData={lesson.roleOther} userLang={lang} spanPrefix=" " /></span>
                        </>
                    )}
                </div>
                <div className="mission-toggle-icon">
                    <i className={'bi ' + (expanded ? 'bi-chevron-up' : 'bi-chevron-down')} id="mission-carat"></i>
                </div>
            </div>
        </div>
    );
}
