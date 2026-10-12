import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ViewAndContinueButtons from './ViewAndContinueButtons.jsx';
import ResponseDecisionButtons from './ResponseDecisionButtons.jsx';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real helper pauses the mounted lesson player; stub it so these row tests
// assert the wiring without a live lesson video element.
const pauseCalls = [];
vi.mock('../../modules/lesson/lesson-progression.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        pauseLessonVideoForTutorial: () => {
            pauseCalls.push(true);
        },
        replaySimpleVideo: vi.fn(),
    };
});

describe('tutorial wiring in the decision rows', () => {
    let container;
    let root;

    beforeEach(() => {
        pauseCalls.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        appStore.getState().setCurrentVideo(null);
        appStore.getState().setGuestNativeLanguage(null);
        vi.clearAllMocks();
    });

    const render = (element) => {
        act(() => {
            root.render(element);
        });
    };

    const click = (id) => {
        act(() => {
            container.querySelector(`#${id}`).click();
        });
    };

    const videoSrc = () => container.querySelector('#tutorialVideo')?.getAttribute('src');

    // Opening pauses exactly once, from the modal's mount effect — the single
    // pause site (rows only open the modal). Pinning the exact count is what
    // stops a second call site being added back unnoticed.
    const expectPausedExactlyOnce = () => {
        expect(pauseCalls).toHaveLength(1);
    };

    it('view-and-continue row opens the viewAndContinue tutorial and pauses the lesson', () => {
        render(<ViewAndContinueButtons />);
        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();

        click('tutorialBtn');

        expect(videoSrc()).toContain('/assets/videos/tutorial-viewAndContinue.mp4');
        expectPausedExactlyOnce();
    });

    it.each(['closedResponse', 'openResponse', 'friendClosedResponse'])(
        'response row opens the %s tutorial and pauses the lesson', (responseType) => {
            act(() => {
                appStore.getState().setCurrentVideo({ type: 'simple', responseType, url: '/assets/videos/x.mp4' });
            });
            render(<ResponseDecisionButtons />);

            click('responseTutorialBtn');

            expect(videoSrc()).toContain(`/assets/videos/tutorial-${responseType}.mp4`);
            expectPausedExactlyOnce();
        }
    );

    it('response row does not open a tutorial for an unsupported step type', () => {
        act(() => {
            appStore.getState().setCurrentVideo({ type: 'simple', responseType: 'lessonIntro', url: '/assets/videos/x.mp4' });
        });
        render(<ResponseDecisionButtons />);

        click('responseTutorialBtn');

        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
        expect(pauseCalls.length).toBe(0);
    });

    it('response row does not open a tutorial when no step video is mounted', () => {
        render(<ResponseDecisionButtons />);

        click('responseTutorialBtn');

        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
        expect(pauseCalls.length).toBe(0);
    });
});
