import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showErrorMessageInQuestionsContainer, setupLessonUI, DOM } from './ui.js';

describe('UI Component functions', () => {
    beforeEach(() => {
        // Set up the JSDOM environment
        document.body.innerHTML = `
            <div id="questions-container"></div>
            <div class="ivp-main-wrapper d-none"></div>
            <footer class="d-none"></footer>
            <div id="bottomButtonBar" class="d-none"></div>
            <div id="bottomButtonBarSuccess"></div>
            <div id="lesson-header" class="lesson-header" style="display: none;"></div>
            <div class="lesson-title">Old Title</div>
            <div class="lesson-title">Old Title 2</div>
        `;

        // Mock the DOM getter if needed, though setupLessonUI uses document.getElementById/querySelector mostly
        Object.defineProperty(DOM, 'mediaContainer', {
            get: () => document.createElement('div'), // Mocking mediaContainer
            configurable: true
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    describe('showErrorMessageInQuestionsContainer', () => {
        it('should render an error message into the questions-container', () => {
            showErrorMessageInQuestionsContainer('Test error message');
            const container = document.getElementById('questions-container');
            expect(container.innerHTML).toContain('Test error message');
            expect(container.innerHTML).toContain('alert-danger');
        });

        it('should do nothing if questions-container is missing', () => {
            document.body.innerHTML = ''; // Remove container
            expect(() => showErrorMessageInQuestionsContainer('Test')).not.toThrow();
        });
    });

    describe('setupLessonUI', () => {
        it('should update DOM classes and text content appropriately', () => {
            // Pre-condition check
            expect(document.querySelector('.ivp-main-wrapper').classList.contains('d-none')).toBe(true);

            setupLessonUI('New Awesome Lesson');

            // Assertions
            expect(document.querySelector('.ivp-main-wrapper').classList.contains('d-none')).toBe(false);
            expect(document.querySelector('footer').classList.contains('d-none')).toBe(false);
            expect(document.getElementById('bottomButtonBar').classList.contains('d-none')).toBe(false);
            expect(document.getElementById('bottomButtonBarSuccess').classList.contains('d-none')).toBe(true);
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