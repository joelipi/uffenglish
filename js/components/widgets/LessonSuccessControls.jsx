import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function LessonSuccessControls() {
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);

    if (bottomControlState !== 'lessonSuccess') return null;

    return (
        <div className="d-flex gap-3 align-items-center" id="state-lesson-success">
            <button className="btn btn-outline-primary w-100 text-white" id="createVideoButton" aria-label="Create Video">
                <i className="bi bi-film text-white"></i>
            </button>
        </div>
    );
}
