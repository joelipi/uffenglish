import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TutorialModal from './TutorialModal.jsx';
import { appStore } from '../../modules/store/store.js';
import { TUTORIAL_SCRIPTS } from '../../modules/video/tutorial-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The lesson video pause lives in lesson-progression, which builds its
// progression instance from module-level deps; stub the imported function so
// the component test asserts the call happened without a store config.
const pauseCalls = [];
vi.mock('../../modules/lesson/lesson-progression.js', () => ({
    pauseLessonVideoForTutorial: () => {
        pauseCalls.push(true);
    },
}));

const render = (props) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<TutorialModal {...props} />);
    });
    return {
        container,
        cleanup: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('TutorialModal', () => {
    beforeEach(() => {
        pauseCalls.length = 0;
        appStore.getState().setGuestNativeLanguage(null);
    });

    afterEach(() => {
        appStore.getState().setGuestNativeLanguage(null);
        vi.clearAllMocks();
    });

    it('renders nothing for an unsupported step type', () => {
        const { container, cleanup } = render({ topic: 'lessonIntro', onClose: vi.fn() });
        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
        cleanup();
    });

    it('opens as a full-screen scrollable overlay with a scrollable card', () => {
        const { container, cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        const overlay = container.querySelector('.tutorial-modal-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.id).toBe('tutorial-modal-overlay');
        expect(overlay.getAttribute('role')).toBe('dialog');
        expect(overlay.getAttribute('aria-modal')).toBe('true');
        expect(container.querySelector('.tutorial-modal-content')).not.toBeNull();
        cleanup();
    });

    it('pauses the lesson underneath exactly once on mount', () => {
        const { cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        expect(pauseCalls).toHaveLength(1);
        cleanup();
    });

    it('does not pause the lesson for an unsupported step type', () => {
        const { cleanup } = render({ topic: 'success', onClose: vi.fn() });
        expect(pauseCalls).toHaveLength(0);
        cleanup();
    });

    it('shows the step-type video, portrait and tap-to-play', () => {
        const { container, cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        const video = container.querySelector('#tutorialVideo');
        expect(video).not.toBeNull();
        expect(video.getAttribute('src')).toContain('/assets/videos/tutorial-branching.mp4');
        expect(video.hasAttribute('controls')).toBe(true);
        expect(video.hasAttribute('playsInline')).toBe(true);
        expect(video.getAttribute('preload')).toBe('metadata');
        expect(video.hasAttribute('autoplay')).toBe(false);
        expect(video.paused).toBe(true);
        cleanup();
    });

    it('renders the English script subtitles for an English guest', () => {
        const { container, cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        const subtitle = container.querySelector('.tutorial-modal-subtitle-text');
        expect(subtitle.textContent).toBe(TUTORIAL_SCRIPTS.branching.en);
        expect(subtitle.getAttribute('lang')).toBe('en');
        cleanup();
    });

    it('renders the Spanish script subtitles for a guest who picked Spanish', () => {
        act(() => {
            appStore.getState().setGuestNativeLanguage('es');
        });
        const { container, cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        const subtitle = container.querySelector('.tutorial-modal-subtitle-text');
        expect(subtitle.textContent).toBe(TUTORIAL_SCRIPTS.branching.es);
        expect(subtitle.getAttribute('lang')).toBe('es');
        cleanup();
    });

    it('renders Portuguese subtitles for a Portuguese guest', () => {
        act(() => {
            appStore.getState().setGuestNativeLanguage('pt');
        });
        const { container, cleanup } = render({ topic: 'friendClosedResponse', onClose: vi.fn() });
        const subtitle = container.querySelector('.tutorial-modal-subtitle-text');
        expect(subtitle.textContent).toBe(TUTORIAL_SCRIPTS.friendClosedResponse.pt);
        expect(subtitle.getAttribute('lang')).toBe('pt');
        cleanup();
    });

    it('labels Continue with the localized continue string', () => {
        const { container, cleanup } = render({ topic: 'viewAndContinue', onClose: vi.fn() });
        const continueBtn = container.querySelector('#tutorialContinueBtn');
        expect(continueBtn.getAttribute('type')).toBe('button');
        expect(continueBtn.textContent).toContain('CONTINUE');
        expect(continueBtn.querySelector('span')).toBeNull();
        cleanup();

        act(() => {
            appStore.getState().setGuestNativeLanguage('es');
        });
        const es = render({ topic: 'viewAndContinue', onClose: vi.fn() });
        const esBtn = es.container.querySelector('#tutorialContinueBtn');
        expect(esBtn.textContent).toContain('CONTINUAR');
        expect(esBtn.querySelector('span').getAttribute('lang')).toBe('es');
        es.cleanup();
    });

    it('renders the corner X control', () => {
        const { container, cleanup } = render({ topic: 'branching', onClose: vi.fn() });
        const closeBtn = container.querySelector('#tutorialCloseBtn');
        expect(closeBtn.getAttribute('type')).toBe('button');
        expect(closeBtn.getAttribute('aria-label')).toBe('Close');
        expect(closeBtn.querySelector('i.bi.bi-x-lg')).not.toBeNull();
        cleanup();
    });

    it('calls onClose from the X, Continue, backdrop and Escape', () => {
        const onClose = vi.fn();
        const { container, cleanup } = render({ topic: 'branching', onClose });
        const overlay = container.querySelector('.tutorial-modal-overlay');

        act(() => { container.querySelector('#tutorialCloseBtn').click(); });
        expect(onClose).toHaveBeenCalledTimes(1);

        act(() => { container.querySelector('#tutorialContinueBtn').click(); });
        expect(onClose).toHaveBeenCalledTimes(2);

        act(() => { overlay.click(); });
        expect(onClose).toHaveBeenCalledTimes(3);

        // A click on the card itself must not close (content stops propagation).
        act(() => { container.querySelector('.tutorial-modal-content').click(); });
        expect(onClose).toHaveBeenCalledTimes(3);

        act(() => {
            window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(onClose).toHaveBeenCalledTimes(4);

        cleanup();
    });
});
