import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    showChat, addAILoadingMessage,
    addAIFeedbackMessages, clearChat
} from './chat/chat-interface.js';
import { appStore } from '../modules/store/store.js';

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
            appStore.getState().setCriticalErrorMessage('Test error message');
            expect(appStore.getState().criticalErrorMessage).toBe('Test error message');
        });

        it('should clear critical error in store', () => {
            appStore.getState().setCriticalErrorMessage('Test error message');
            appStore.getState().setCriticalErrorMessage(null);
            expect(appStore.getState().criticalErrorMessage).toBeNull();
        });
    });

    describe('Chat Interface Rendering', () => {
        beforeEach(() => {
            appStore.setState({ chatHistory: [] });
        });

        it('should execute showChat without error', () => {
            expect(() => showChat()).not.toThrow();
        });

        it('should add user chat message to store', () => {
             appStore.setState({ userData: { display_name: 'Test User', profilepicurl: 'http://test.jpg' } });

             appStore.getState().addChatMessage({
                 role: 'user',
                 type: 'standard',
                 content: 'my answer',
                 userName: 'Test',
                 userAvatarUrl: 'http://test.jpg'
             });
             const history = appStore.getState().chatHistory;
             expect(history.some(m => m.content === 'my answer')).toBe(true);
             expect(history.some(m => m.userName === 'Test')).toBe(true);
         });

        it('should render AI analysis loading', () => {
             expect(() => addAILoadingMessage('loading test')).not.toThrow();
             let history = appStore.getState().chatHistory;
             expect(history.some(m => m.type === 'aiLoading' && m.content.includes('loading test'))).toBe(true);

             appStore.getState().removeAiLoadingMessage();
             history = appStore.getState().chatHistory;
             expect(history.some(m => m.type === 'aiLoading')).toBe(false);
         });

        it('should render AI feedback chunks correctly', () => {
            const chunks = [
                { role: 'system', type: 'standard', content: 'html chunk' },
                { role: 'system', type: 'standard', content: 'Just a simple string' }
            ];

            expect(() => addAIFeedbackMessages(chunks)).not.toThrow();
            const history = appStore.getState().chatHistory;
            expect(history.some(m => m.content.includes('html chunk'))).toBe(true);
            expect(history.some(m => m.content.includes('Just a simple string'))).toBe(true);
        });

        it('should test clearChat', () => {
             expect(() => clearChat()).not.toThrow();
             expect(appStore.getState().chatHistory.length).toBe(0);
        });
    });

});
