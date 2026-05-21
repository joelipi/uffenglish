import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    showInitializationErrorMessage, setupLessonUI, DOM, escapeHTML, getFirstName, flashElement,
    disableAllButtons, showCriticalError,
    hideCriticalError,
    safeRenderChatInterface, renderUserChatMessage, renderAIAnalysisLoading, removeAILoadingStatus,
    getPraiseHTML, renderAIFeedback, clearChatInterface, renderHangmanHint, showMicWarning,
    showAnswerError, setProgressBarWidth, hideAnswerDiv, bindProcessButton, resetUIForNewStep,
    toggleStatsContainer, removeRepeatButton
} from './ui.js';
import { appStore } from '../modules/store.js';
import { State } from '../modules/state.js';

describe('UI Component functions', () => {

    beforeEach(() => {
        // Set up the JSDOM environment
        document.body.innerHTML = `
             <div id="steps-container"></div>
             <div id="criticalErrorContainer" class="d-none alert alert-danger">
                 <span id="criticalErrorMessage"></span>
             </div>
             <div id="media-viewport" class="d-none"></div>
             <div class="ivp-main-wrapper d-none"></div>
             <footer class="d-none"></footer>
             <div id="lesson-header" class="lesson-header" style="display: none;"></div>
             <div class="lesson-title">Old Title</div>
             <div class="lesson-title">Old Title 2</div>
             <div id="test-container"><button></button><button></button></div>
             <div id="flash-element"></div>
             <span id="listeningScore">100</span>
             <span id="pronunciationScore">100</span>
             <span id="dayCountSpan">0</span>
             <span id="streakCountSpan">0</span>
             <div id="chat-window-container" class="d-none"></div>
             <div class="bottom-overlay"></div>
             <div id="chat-message-list">
                <div id="ai-loading-status"></div>
             </div>
             <div id="chat-name-system">System</div>
             <img id="chat-avatar-system" />
         `;
         vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    describe('Critical Error Handling', () => {
        it('should update criticalErrorMessage in store', () => {
            showCriticalError('Test error message');
            expect(appStore.getState().criticalErrorMessage).toBe('Test error message');
        });

        it('should route showInitializationErrorMessage to showCriticalError', () => {
            showInitializationErrorMessage('Init error');
            expect(appStore.getState().criticalErrorMessage).toBe('Init error');
        });

        it('should hide critical error', () => {
            showCriticalError('Test error message');
            hideCriticalError();
            expect(appStore.getState().criticalErrorMessage).toBeNull();
        });
    });

    describe('setupLessonUI', () => {
        it('should update DOM classes and text content appropriately', () => {
            setupLessonUI('New Awesome Lesson');

            expect(document.querySelector('.ivp-main-wrapper').classList.contains('d-none')).toBe(false);
            expect(document.querySelector('footer').classList.contains('d-none')).toBe(false);
            expect(document.getElementById('media-viewport').classList.contains('d-none')).toBe(false);
            expect(document.body.classList.contains('bg-dark')).toBe(false);

            const header = document.getElementById('lesson-header');
            expect(header.style.display).toBe('block');
            expect(header.classList.contains('lesson-header')).toBe(true);

            const titles = document.getElementsByClassName('lesson-title');
            expect(titles[0].textContent).toBe('New Awesome Lesson');
            expect(titles[1].textContent).toBe('New Awesome Lesson');
        });
    });

    describe('escapeHTML', () => {
        it('should replace special characters with html entities', () => {
            expect(escapeHTML('<script>alert("test & it \' works")</script>'))
                .toBe('&lt;script&gt;alert(&quot;test &amp; it &#39; works&quot;)&lt;/script&gt;');
        });
        it('should handle null/undefined', () => {
            expect(escapeHTML(null)).toBe('');
            expect(escapeHTML(undefined)).toBe('');
        });
    });

    describe('getFirstName', () => {
        it('should extract the first name from a full name', () => {
            expect(getFirstName('John Doe')).toBe('John');
            expect(getFirstName('Alice')).toBe('Alice');
            expect(getFirstName(' ')).toBe('');
            expect(getFirstName(null)).toBe('User');
            expect(getFirstName(undefined)).toBe('User');
        });
    });

    describe('disableAllButtons', () => {
        it('should disable all buttons within a container', () => {
            const container = document.getElementById('test-container');
            const buttons = container.querySelectorAll('button');
            expect(buttons[0].disabled).toBe(false);

            disableAllButtons(container);

            expect(buttons[0].disabled).toBe(true);
            expect(buttons[1].disabled).toBe(true);
        });

        it('should do nothing if container is falsy', () => {
            expect(() => disableAllButtons(null)).not.toThrow();
        });
    });

    describe('flashElement', () => {
        it('should add and remove animation classes', () => {
            vi.useFakeTimers();
            const el = document.getElementById('flash-element');

            flashElement(el);

            expect(el.classList.contains('score-update')).toBe(true);

            vi.advanceTimersByTime(300);

            expect(el.classList.contains('score-update')).toBe(false);

            vi.useRealTimers();
        });
        it('should do nothing if element is missing', () => {
            expect(() => flashElement(null)).not.toThrow();
        });
    });


    describe('Chat Interface Rendering', () => {
        beforeEach(() => {
            appStore.setState({ chatHistory: [] });
        });

        it('should execute safeRenderChatInterface safely', () => {
            expect(() => safeRenderChatInterface(true)).not.toThrow();
            expect(document.body.classList.contains('chat-mode-active')).toBe(true);
        });

        it('should render user response', () => {
             State.userData = { display_name: 'Test User', profilepicurl: 'http://test.jpg' };
             appStore.setState({ userData: { display_name: 'Test User', profilepicurl: 'http://test.jpg' } });

             expect(() => renderUserChatMessage('my answer')).not.toThrow();
             const history = appStore.getState().chatHistory;
             expect(history.some(m => m.content === 'my answer')).toBe(true);
             expect(history.some(m => m.userName === 'Test')).toBe(true);
        });

        it('should render AI analysis loading', () => {
             expect(() => renderAIAnalysisLoading('loading test')).not.toThrow();
             let history = appStore.getState().chatHistory;
             expect(history.some(m => m.type === 'aiLoading' && m.content.includes('loading test'))).toBe(true);

             removeAILoadingStatus();
             history = appStore.getState().chatHistory;
             expect(history.some(m => m.type === 'aiLoading')).toBe(false);
        });

        it('should get praise HTML without errors', () => {
             expect(getPraiseHTML(null)).toBe('');
             expect(getPraiseHTML('Good job!')).toBe('Good job!');
             expect(getPraiseHTML({ text: 'Good job!' })).toBe('Good job!');
             expect(getPraiseHTML({ type: 'image', content: 'test.jpg' })).toContain('img src="test.jpg"');
        });

        it('should render AI feedback chunks correctly', () => {
            const chunks = [
                '<div class="chat-message-row">html chunk</div>',
                'Just a simple string'
            ];

            expect(() => renderAIFeedback(chunks)).not.toThrow();
            const history = appStore.getState().chatHistory;
            expect(history.some(m => m.content.includes('html chunk'))).toBe(true);
            expect(history.some(m => m.content.includes('Just a simple string'))).toBe(true);
        });

        it('should test clearChatInterface', () => {
             expect(() => clearChatInterface()).not.toThrow();
             expect(appStore.getState().chatHistory.length).toBe(0);
        });
    });

    describe('Hints and Errors Rendering', () => {
        it('should render hangman hint', () => {
            document.body.innerHTML += '<div id="hintUncommonWords"></div>';
            renderHangmanHint('<span>hint text</span>');
            expect(document.getElementById('hintUncommonWords').innerHTML).toBe('<span>hint text</span>');
        });

        it('should show mic warning', () => {
            document.body.innerHTML += '<div id="micStatusText"></div>';
            showMicWarning('Warning!');
            expect(document.getElementById('micStatusText').innerHTML).toContain('Warning!');
        });

        it('should show answer error and hide after timeout', () => {
            vi.useFakeTimers();
            document.body.innerHTML += '<div id="answer-error-message" class="d-none"></div>';

            showAnswerError('Answer is wrong');
            const msg = document.getElementById('answer-error-message');
            expect(msg.innerHTML).toBe('Answer is wrong');
            expect(msg.classList.contains('d-none')).toBe(false);

            vi.advanceTimersByTime(4000);
            expect(msg.classList.contains('d-none')).toBe(true);
            vi.useRealTimers();
        });
    });

    describe('Miscellaneous UI Functions', () => {
        it('should set progress bar width', () => {
            document.body.innerHTML += '<div id="progress-bar"></div>';
            setProgressBarWidth('50%');
            expect(document.getElementById('progress-bar').style.width).toBe('50%');
        });

        it('should hide answer div', () => {
            document.body.innerHTML += '<div id="answerDiv" class=""></div>';
            hideAnswerDiv();
            expect(document.getElementById('answerDiv').classList.contains('d-none')).toBe(true);
        });

        it('should bind process button', () => {
            document.body.innerHTML += '<button id="processBtn"></button>';
            const mockClick = vi.fn();
            bindProcessButton(mockClick);
            document.getElementById('processBtn').click();
            expect(mockClick).toHaveBeenCalled();
        });
    });

    describe('resetUIForNewStep', () => {
        it('should remove elements and reset buttons', () => {
            document.body.innerHTML = `
                <div id="resultVideo"></div>
                <div id="displayCanvas"></div>
                <button id="continueButtonSuccess"></button>
                <button id="repeatButtonSuccess"></button>
                <button id="processBtn" class="btn-success flex-fill" disabled></button>
                <div id="state-lesson-success" class=""></div>
                <div id="lessonIntroHeader"></div>
                <div id="closeAndProgress"></div>
                <div id="success-media" class=""></div>
                <div id="myToast"><button class="btn-close"></button></div>
            `;

            // Should hide closeAndProgress since we pass (true, false) for intro and hasUserData
            resetUIForNewStep(true, false);

            expect(document.getElementById('resultVideo')).toBeNull();
            expect(document.getElementById('displayCanvas')).toBeNull();
            expect(document.getElementById('continueButtonSuccess')).toBeNull();
            expect(document.getElementById('repeatButtonSuccess')).toBeNull();

            const btn = document.getElementById('processBtn');
            expect(btn.disabled).toBe(false);
            expect(btn.classList.contains('btn-success')).toBe(false);
            expect(btn.classList.contains('btn-outline-primary')).toBe(true);

            expect(document.getElementById('state-lesson-success').classList.contains('d-none')).toBe(true);
            expect(document.getElementById('lessonIntroHeader').classList.contains('d-none')).toBe(false);
            expect(document.getElementById('closeAndProgress').classList.contains('d-none')).toBe(true);
            expect(document.getElementById('success-media').classList.contains('d-none')).toBe(true);
        });
    });

    describe('toggleStatsContainer & removeRepeatButton', () => {
        it('should toggle scores container', () => {
            document.body.innerHTML = '<div id="stats-container" class="d-none"></div>';

            toggleStatsContainer(true);
            expect(document.getElementById('stats-container').classList.contains('d-none')).toBe(false);

            toggleStatsContainer(false);
            expect(document.getElementById('stats-container').classList.contains('d-none')).toBe(true);
        });

        it('should remove repeat button', () => {
            document.body.innerHTML = '<button id="repeatButton"></button>';
            removeRepeatButton();
            expect(document.getElementById('repeatButton')).toBeNull();
        });
    });
});
