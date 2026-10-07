import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import BranchChoiceButtons from './BranchChoiceButtons.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('BranchChoiceButtons', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
    });

    const render = (props) => {
        act(() => {
            root.render(<BranchChoiceButtons {...props} />);
        });
    };

    const twoChoicesView = {
        choices: [
            { key: 0, targetIndex: 3, label: { english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: true } },
            { key: 1, targetIndex: 4, label: { english: 'No', localized: null, lang: 'es', showEnglish: true } },
        ],
        showContinue: false,
    };

    const click = (el) => {
        act(() => {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    };

    it('renders one button per choice and labels them bilingually', () => {
        render({ view: twoChoicesView, onChoose: vi.fn(), onReplay: vi.fn(), onContinue: vi.fn() });

        const first = container.querySelector('#branchChoiceBtn-0');
        const second = container.querySelector('#branchChoiceBtn-1');
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();

        expect(first.textContent).toContain('Yes');
        expect(first.textContent).toContain('Sí');
        expect(second.textContent).toContain('No');
        expect(second.textContent).not.toContain('Sí');
    });

    it('calls onChoose with the choice targetIndex', () => {
        const onChoose = vi.fn();
        render({ view: twoChoicesView, onChoose, onReplay: vi.fn(), onContinue: vi.fn() });

        click(container.querySelector('#branchChoiceBtn-0'));
        expect(onChoose).toHaveBeenCalledWith(3);
    });

    it('drops the English line when showEnglish is false', () => {
        render({
            view: {
                choices: [{
                    key: 0,
                    targetIndex: 3,
                    label: { english: 'Yes', localized: 'Sí', lang: 'es', showEnglish: false },
                }],
                showContinue: false,
            },
            onChoose: vi.fn(), onReplay: vi.fn(), onContinue: vi.fn(),
        });

        const btn = container.querySelector('#branchChoiceBtn-0');
        expect(btn.querySelector('.branch-choice-label-en')).toBeNull();
        expect(btn.textContent).toContain('Sí');
    });

    it('renders a Continue button when there are no choices', () => {
        const onContinue = vi.fn();
        render({ view: { choices: [], showContinue: true }, onChoose: vi.fn(), onReplay: vi.fn(), onContinue });

        expect(container.querySelector('#branchContinueBtn')).not.toBeNull();
        expect(container.querySelector('#branchChoiceBtn-0')).toBeNull();

        click(container.querySelector('#branchContinueBtn'));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('always renders the replay and tutorial corner buttons', () => {
        const onReplay = vi.fn();
        render({ view: twoChoicesView, onChoose: vi.fn(), onReplay, onContinue: vi.fn() });

        expect(container.querySelector('#branchReplayBtn')).not.toBeNull();
        expect(container.querySelector('#branchTutorialBtn')).not.toBeNull();

        click(container.querySelector('#branchReplayBtn'));
        expect(onReplay).toHaveBeenCalledTimes(1);
    });

    it('mounts the tutorial modal when the tutorial button is pressed', () => {
        render({ view: twoChoicesView, onChoose: vi.fn(), onReplay: vi.fn(), onContinue: vi.fn() });

        expect(container.querySelector('.tutorial-modal-overlay')).toBeNull();
        click(container.querySelector('#branchTutorialBtn'));
        expect(container.querySelector('.tutorial-modal-overlay')).not.toBeNull();
    });
});
