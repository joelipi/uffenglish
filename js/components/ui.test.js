import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showInitializationErrorMessage, setupLessonUI, DOM } from './ui.js';

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
         `;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    describe('showInitializationErrorMessage', () => {
        it('should render an error message into the criticalErrorContainer', () => {
            showInitializationErrorMessage('Test error message');
            const message = document.getElementById('criticalErrorMessage');
            const container = document.getElementById('criticalErrorContainer');
            expect(message.innerHTML).toContain('Test error message');
            expect(container.classList.contains('d-none')).toBe(false);
        });

        it('should do nothing if criticalErrorContainer is missing', () => {
            document.body.innerHTML = ''; // Remove container
            expect(() => showInitializationErrorMessage('Test')).not.toThrow();
        });
    });

    describe('setupLessonUI', () => {
        it('should update DOM classes and text content appropriately', () => {
            // Pre-condition check
            expect(document.querySelector('.ivp-main-wrapper').classList.contains('d-none')).toBe(true);
            expect(document.getElementById('media-viewport').classList.contains('d-none')).toBe(true);

            setupLessonUI('New Awesome Lesson');

            // Assertions
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
});
