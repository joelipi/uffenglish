import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PreviewTutorialButton from './PreviewTutorialButton.jsx';
import { appStore } from '../../modules/store/store.js';
import { TUTORIAL_SCRIPTS } from '../../modules/video/tutorial-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The modal's mount effect pauses the lesson player; stub it so this component
// test does not need a live lesson video element.
const pauseCalls = [];
vi.mock('../../modules/lesson/lesson-progression.js', () => ({
    pauseLessonVideoForTutorial: () => {
        pauseCalls.push(true);
    },
}));

describe('PreviewTutorialButton', () => {
    let container;
    let root;

    beforeEach(() => {
        pauseCalls.length = 0;
        appStore.getState().setGuestNativeLanguage(null);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        appStore.getState().setGuestNativeLanguage(null);
        vi.clearAllMocks();
    });

    const render = () => {
        act(() => root.render(<PreviewTutorialButton />));
    };

    const click = (id) => {
        act(() => container.querySelector(`#${id}`).click());
    };

    it('renders the shared label + circular call button without opening anything', () => {
        render();

        const button = container.querySelector('#previewTutorialBtn');
        expect(button).not.toBeNull();
        expect(button.getAttribute('type')).toBe('button');
        // Exactly the same button appearance as the decision rows: no
        // preview-only class or style.
        expect(button.classList.contains('btn')).toBe(true);
        expect(button.classList.contains('call-btn')).toBe(true);
        expect(button.classList.contains('preview-tutorial-btn')).toBe(false);
        expect(button.querySelector('i.bi.bi-question-lg')).not.toBeNull();
        // The label comes from the shared ChoiceColumn, like every other row.
        expect(container.querySelector('.ivp-choice-col')).not.toBeNull();
        expect(container.querySelector('.ivp-choice-label-text').textContent).toContain('WATCH TUTORIAL');
        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
    });

    it('opens the preview screen guide, not the step-type guide', () => {
        render();
        click('previewTutorialBtn');

        const overlay = container.querySelector('.tutorial-modal-overlay');
        expect(overlay).not.toBeNull();
        const video = container.querySelector('#tutorialVideo');
        expect(video.getAttribute('src')).toContain('/assets/videos/tutorial-friendRecordingPreview.mp4');
        expect(video.getAttribute('src')).not.toContain('/tutorial-friendClosedResponse.mp4');
        expect(container.querySelector('.tutorial-modal-subtitle-text').textContent)
            .toBe(TUTORIAL_SCRIPTS.friendRecordingPreview.en);
        expect(pauseCalls).toHaveLength(1);
    });

    it('shows the session language subtitles', () => {
        act(() => appStore.getState().setGuestNativeLanguage('es'));
        render();
        click('previewTutorialBtn');

        const subtitle = container.querySelector('.tutorial-modal-subtitle-text');
        expect(subtitle.textContent).toBe(TUTORIAL_SCRIPTS.friendRecordingPreview.es);
        expect(subtitle.getAttribute('lang')).toBe('es');
    });

    it('closes the guide from its corner X', () => {
        render();
        click('previewTutorialBtn');
        expect(container.querySelector('.tutorial-modal-overlay')).not.toBeNull();

        click('tutorialCloseBtn');
        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
    });
});
