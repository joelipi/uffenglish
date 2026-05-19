import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showInitializationErrorMessage, setupLessonUI, DOM, escapeHTML, getFirstName, flashElement, disableAllButtons, updateCurrentScoreDisplay, updateSpeakingScoreDisplay, showCriticalError, hideCriticalError, updateActivityDisplay, updateDayCountDisplay } from './ui.js';
import { appStore } from '../modules/store.js';

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
        it('should render an error message into the criticalErrorContainer', () => {
            showCriticalError('Test error message');
            const message = document.getElementById('criticalErrorMessage');
            const container = document.getElementById('criticalErrorContainer');
            expect(message.innerHTML).toContain('Test error message');
            expect(container.classList.contains('d-none')).toBe(false);
        });

        it('should route showInitializationErrorMessage to showCriticalError', () => {
            showInitializationErrorMessage('Init error');
            const message = document.getElementById('criticalErrorMessage');
            expect(message.innerHTML).toContain('Init error');
        });

        it('should do nothing if criticalErrorContainer is missing', () => {
            document.body.innerHTML = ''; // Remove container
            expect(() => showCriticalError('Test')).not.toThrow();
        });

        it('should hide critical error', () => {
            showCriticalError('Test error message');
            hideCriticalError();
            const container = document.getElementById('criticalErrorContainer');
            expect(container.classList.contains('d-none')).toBe(true);
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

    describe('updateCurrentScoreDisplay', () => {
        it('should update listeningScore display and flash if decreased', () => {
            appStore.setState({ listeningScore: 90 });
            vi.useFakeTimers();

            updateCurrentScoreDisplay(); // should use store value

            const span = document.getElementById('listeningScore');
            expect(span.textContent).toBe('90');
            expect(span.classList.contains('score-update')).toBe(true);

            vi.advanceTimersByTime(300);
            expect(span.classList.contains('score-update')).toBe(false);

            vi.useRealTimers();
        });

        it('should accept direct score value', () => {
            updateCurrentScoreDisplay(85);
            const span = document.getElementById('listeningScore');
            expect(span.textContent).toBe('85');
        });
    });

    describe('updateSpeakingScoreDisplay', () => {
        it('should update speakingScore display', () => {
            appStore.setState({ speakingScore: 70 });
            updateSpeakingScoreDisplay(); // should use store value
            const span = document.getElementById('pronunciationScore');
            expect(span.textContent).toBe('70');
        });

        it('should accept direct score value', () => {
            updateSpeakingScoreDisplay(60);
            const span = document.getElementById('pronunciationScore');
            expect(span.textContent).toBe('60');
        });
    });

    describe('updateActivityDisplay & updateDayCountDisplay', () => {
        it('should update both total days and current streak', () => {
            updateActivityDisplay(5, 3);
            expect(document.getElementById('dayCountSpan').textContent).toBe('5');
            expect(document.getElementById('streakCountSpan').textContent).toBe('3');
        });

        it('should handle undefined totalDays and currentStreak gracefully', () => {
             expect(() => updateActivityDisplay(undefined, undefined)).not.toThrow();
        });

        it('should update just dayCount using updateDayCountDisplay', () => {
            updateDayCountDisplay(15);
            expect(document.getElementById('dayCountSpan').textContent).toBe('15');
        });

        it('should fallback to store state in updateDayCountDisplay', () => {
            appStore.setState({ dayCount: 22 });
            updateDayCountDisplay();
            expect(document.getElementById('dayCountSpan').textContent).toBe('22');
        });
    });

    describe('Chat Interface Rendering', () => {
        it('should execute safeRenderChatInterface safely', () => {
            // Because safeRenderChatInterface uses specific DOM properties we mocked
            // we can test it directly
            const { safeRenderChatInterface } = require('./ui.js');
            expect(() => safeRenderChatInterface(true, '<p>test</p>')).not.toThrow();
            expect(document.body.classList.contains('chat-mode-active')).toBe(true);
            const chatList = document.getElementById('chat-message-list');
            expect(chatList.innerHTML).toContain('<p>test</p>');
        });

        it('should append a Node to the chat body', () => {
             const { safeRenderChatInterface } = require('./ui.js');
             const div = document.createElement('div');
             div.id = 'test-node';
             safeRenderChatInterface(true, div);
             const chatList = document.getElementById('chat-message-list');
             expect(chatList.querySelector('#test-node')).toBeDefined();
        });

        it('should render user response', () => {
             const { renderUserResponse } = require('./ui.js');
             // ui.js looks at State.userData as well for fallback, let's mock the State or appStore correctly
             const { State } = require('../modules/state.js');
             State.userData = { display_name: 'Test User', profilepicurl: 'http://test.jpg' };
             appStore.setState({ userData: { display_name: 'Test User', profilepicurl: 'http://test.jpg' } });

             expect(() => renderUserResponse('my answer')).not.toThrow();
             const chatList = document.getElementById('chat-message-list');
             expect(chatList.innerHTML).toContain('my answer');
             expect(chatList.innerHTML).toContain('Test');
             expect(chatList.innerHTML).toContain('http://test.jpg');
        });

        it('should render AI analysis loading', () => {
             const { renderAIAnalysisLoading, removeAILoadingStatus } = require('./ui.js');
             expect(() => renderAIAnalysisLoading('loading test')).not.toThrow();
             const chatList = document.getElementById('chat-message-list');
             expect(chatList.innerHTML).toContain('loading test');

             removeAILoadingStatus();
             expect(chatList.innerHTML).not.toContain('loading test');
        });

        it('should get praise HTML without errors', () => {
             const { getPraiseHTML } = require('./ui.js');
             expect(getPraiseHTML(null)).toBe('');
             expect(getPraiseHTML('Good job!')).toBe('Good job!');
             expect(getPraiseHTML({ text: 'Good job!' })).toBe('Good job!');
             expect(getPraiseHTML({ type: 'image', content: 'test.jpg' })).toContain('img src="test.jpg"');
        });

        it('should render AI feedback chunks correctly', () => {
            const { renderAIFeedback } = require('./ui.js');
            const pNode = document.createElement('p');
            pNode.textContent = 'Node content';
            const rowNode = document.createElement('div');
            rowNode.classList.add('chat-message-row');
            rowNode.textContent = 'Row Node content';

            const chunks = [
                '<div class="chat-message-row">html chunk</div>',
                'Just a simple string',
                pNode,
                rowNode,
                null,
                undefined
            ];

            expect(() => renderAIFeedback(chunks)).not.toThrow();
            const chatList = document.getElementById('chat-message-list');
            expect(chatList.innerHTML).toContain('html chunk');
            expect(chatList.innerHTML).toContain('Just a simple string');
            expect(chatList.innerHTML).toContain('Node content');
            expect(chatList.innerHTML).toContain('Row Node content');
        });

        it('should test clearChatInterface', () => {
             const { clearChatInterface } = require('./ui.js');
             expect(() => clearChatInterface()).not.toThrow();
        });
    });

    describe('Hints and Errors Rendering', () => {
        it('should render hangman hint', () => {
            const { renderHangmanHint } = require('./ui.js');
            document.body.innerHTML += '<div id="hintUncommonWords"></div>';
            renderHangmanHint('<span>hint text</span>');
            expect(document.getElementById('hintUncommonWords').innerHTML).toBe('<span>hint text</span>');
        });

        it('should show mic warning', () => {
            const { showMicWarning } = require('./ui.js');
            document.body.innerHTML += '<div id="micStatusText"></div>';
            showMicWarning('Warning!');
            expect(document.getElementById('micStatusText').innerHTML).toContain('Warning!');
        });

        it('should show answer error and hide after timeout', () => {
            vi.useFakeTimers();
            const { showAnswerError } = require('./ui.js');
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
            const { setProgressBarWidth } = require('./ui.js');
            document.body.innerHTML += '<div id="progress-bar"></div>';
            setProgressBarWidth('50%');
            expect(document.getElementById('progress-bar').style.width).toBe('50%');
        });

        it('should hide answer div', () => {
            const { hideAnswerDiv } = require('./ui.js');
            document.body.innerHTML += '<div id="answerDiv" class=""></div>';
            hideAnswerDiv();
            expect(document.getElementById('answerDiv').classList.contains('d-none')).toBe(true);
        });

        it('should bind process button', () => {
            const { bindProcessButton } = require('./ui.js');
            document.body.innerHTML += '<button id="processBtn"></button>';
            const mockClick = vi.fn();
            bindProcessButton(mockClick);
            document.getElementById('processBtn').click();
            expect(mockClick).toHaveBeenCalled();
        });
    });

    describe('resetUIForNewStep', () => {
        it('should remove elements and reset buttons', () => {
            const { resetUIForNewStep } = require('./ui.js');
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

    describe('toggleScoresAndHearts & removeRepeatButton', () => {
        it('should toggle scores container', () => {
            const { toggleScoresAndHearts } = require('./ui.js');
            document.body.innerHTML = '<div id="stats-container" class="d-none"></div>';

            toggleScoresAndHearts(true);
            expect(document.getElementById('stats-container').classList.contains('d-none')).toBe(false);

            toggleScoresAndHearts(false);
            expect(document.getElementById('stats-container').classList.contains('d-none')).toBe(true);
        });

        it('should remove repeat button', () => {
            const { removeRepeatButton } = require('./ui.js');
            document.body.innerHTML = '<button id="repeatButton"></button>';
            removeRepeatButton();
            expect(document.getElementById('repeatButton')).toBeNull();
        });
    });
});
