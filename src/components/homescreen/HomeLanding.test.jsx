import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import HomeLanding from './HomeLanding.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeLanding', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const render = (props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(HomeLanding, props)
                )
            );
        });
    };

    const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);

    it('renders the English copy, account link and controls by default', () => {
        render();
        expect(q('share-code-headline').textContent).toBe('Practice English with your friends for free.');
        expect(q('share-code-subheadline').textContent).toBe("Enter your friend's share code");
        expect(q('share-code-go').textContent).toBe('Go');
        expect(q('no-code').textContent).toBe("I don't have a share code");
        expect(q('landing-account-link').getAttribute('href')).toBe('/login');
        expect(q('landing-account-link').textContent).toBe('Sign In');
    });

    it('links a logged-in visitor to /home with the Home label', () => {
        render({ isLoggedIn: true });
        expect(q('landing-account-link').getAttribute('href')).toBe('/home');
        expect(q('landing-account-link').textContent).toBe('Home');
    });

    it('localizes the headline and Go button', () => {
        render({ lang: 'es' });
        expect(q('share-code-headline').textContent).toBe('Practica inglés con tus amigos gratis.');
        expect(q('share-code-go').textContent).toBe('Ir');
    });

    it('renders the UFF logo image in place of the text headline', () => {
        render({ lang: 'es' });
        const logo = q('home-logo');
        expect(logo).not.toBeNull();
        expect(logo.tagName).toBe('IMG');
        expect(logo.getAttribute('alt')).toBe('Fluidez Ultra Rápida');
        // The brand headline is now the image, so the title text is gone.
        expect(container.textContent).not.toContain('Fluidez Ultra Rápida');
    });

    it('updates the input value and calls onInputChange when typed into', () => {
        const onInputChange = vi.fn();
        render({ onInputChange });
        const input = q('share-code-input');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'abc');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('abc');
        expect(onInputChange).toHaveBeenCalledTimes(1);
    });

    it('calls onSubmitCode with the raw field value on submit', () => {
        const onSubmitCode = vi.fn();
        render({ onSubmitCode });
        const input = q('share-code-input');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'abc');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            q('share-code-go').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(onSubmitCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).toHaveBeenCalledWith('abc');
    });

    it('uses a submit-type Go button so click/Enter submits the form', () => {
        render();
        expect(q('share-code-go').getAttribute('type')).toBe('submit');
    });

    it('renders an alert error when error is non-null', () => {
        render({ error: 'boom' });
        expect(q('share-code-error')).not.toBeNull();
        expect(q('share-code-error').textContent).toBe('boom');
        expect(q('share-code-error').getAttribute('role')).toBe('alert');
    });

    it('renders no error element when error is null', () => {
        render({ error: null });
        expect(q('share-code-error')).toBeNull();
    });

    it('disables the Go button while loading', () => {
        render({ loading: true });
        expect(q('share-code-go').hasAttribute('disabled')).toBe(true);
    });

    it('leaves the Go button enabled when not loading', () => {
        render({ loading: false });
        expect(q('share-code-go').hasAttribute('disabled')).toBe(false);
    });

    it('calls onNoCode (and not onSubmitCode) when the no-code button is clicked', () => {
        const onNoCode = vi.fn();
        const onSubmitCode = vi.fn();
        render({ onNoCode, onSubmitCode });
        act(() => { q('no-code').click(); });
        expect(onNoCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).not.toHaveBeenCalled();
    });

    // --- Task 1: app-styled cover, buttons and a scrollable page ---
    it('renders an app-matched, internally scrollable container', () => {
        render();
        const rootEl = container.firstChild;
        expect(rootEl.style.height).toBe('100dvh');
        expect(rootEl.style.overflowY).toBe('auto');
        expect(rootEl.style.backgroundColor).toBe('rgb(11, 26, 42)');
        expect(rootEl.style.fontFamily).toContain('Inter');
    });

    it('styles the Go button as the app gradient primary', () => {
        render();
        const go = q('share-code-go');
        expect(go.tagName).toBe('BUTTON');
        expect(go.getAttribute('type')).toBe('submit');
        expect(go.style.fontWeight).toBe('600');
        expect(go.style.borderRadius).toBe('8px');
        expect(go.style.width).toBe('100%');
        expect(go.style.background).toContain('linear-gradient');
    });

    it('styles the no-code action as an app-style outlined button', () => {
        render();
        const noCode = q('no-code');
        expect(noCode.tagName).toBe('BUTTON');
        expect(noCode.getAttribute('type')).toBe('button');
        expect(noCode.style.borderColor).toBe('rgb(0, 192, 216)');
        expect(noCode.style.borderWidth).toBe('1px');
        expect(noCode.style.borderStyle).toBe('solid');
        expect(noCode.style.fontWeight).toBe('600');
        expect(noCode.style.width).toBe('100%');
        expect(noCode.style.textDecoration).not.toContain('underline');
    });

    // --- Task 2: "How it works" section ---
    it('renders the How it works section with the five English bullets', () => {
        render();
        expect(q('how-it-works')).not.toBeNull();
        const heading = q('how-it-works-heading');
        expect(heading.textContent).toBe('How it works');
        expect(heading.tagName).toBe('H2');

        const list = q('how-it-works-list');
        expect(list.tagName).toBe('UL');
        const items = Array.from(list.children);
        expect(items).toHaveLength(5);
        const expected = [
            "It's 100% free — no card and no subscription, ever.",
            'Any English level works, from beginner to advanced. It teaches you what to say.',
            "You don't need to be online at the same time as your friend.",
            'Answer out loud and get instant feedback on your speaking.',
            "Your friend's videos expire after 48 hours, so start now.",
        ];
        items.forEach((li, i) => {
            expect(li.tagName).toBe('LI');
            expect(li.tagName).not.toBe('H2');
            const span = li.querySelector('span');
            expect(span).not.toBeNull();
            expect(span.textContent).toBe(expected[i]);
        });
    });

    it('localizes the How it works section', () => {
        render({ lang: 'es' });
        expect(q('how-it-works-heading').textContent).toBe('Cómo funciona');
        expect(q('how-it-works-item-1').querySelector('span').textContent)
            .toBe('Es 100% gratis: sin tarjeta y sin suscripción, para siempre.');
    });

    // --- Task 3: "About the teacher" section ---
    it('renders the About the teacher section with the portrait and credentials', () => {
        render();
        expect(q('about-teacher')).not.toBeNull();
        const heading = q('about-teacher-heading');
        expect(heading.textContent).toBe('About the teacher');
        expect(heading.tagName).toBe('H2');
        expect(q('about-teacher-name').textContent).toBe('Joe Walsh');
        expect(q('about-teacher-credentials').textContent)
            .toBe("I have a master's degree in teaching English to speakers of other languages (TESOL) and 20 years of experience teaching English.");

        const photo = q('about-teacher-photo');
        expect(photo.tagName).toBe('IMG');
        expect(photo.getAttribute('alt')).toBe('Joe Walsh');
        expect(photo.getAttribute('src')).toContain('teacherprofile');
        expect(photo.style.borderRadius).toBe('50%');
        expect(photo.style.width).toBe('96px');
    });

    it('localizes the About the teacher section', () => {
        render({ lang: 'es' });
        expect(q('about-teacher-heading').textContent).toBe('Sobre el profesor');
        expect(q('about-teacher-credentials').textContent)
            .toBe('Tengo una maestría en enseñanza de inglés a hablantes de otros idiomas (TESOL) y 20 años de experiencia enseñando inglés.');
    });

    // --- Task 7: homepage language selector ---
    it('renders the language selector with the six homepage languages', () => {
        render();
        const select = q('landing-language-select');
        expect(select.tagName).toBe('SELECT');
        const options = Array.from(select.querySelectorAll('option'));
        expect(options.map((o) => o.value)).toEqual(['EN', 'ES', 'PT', 'FR', 'HI', 'BN']);
        expect(select.value).toBe('EN');
        expect(select.getAttribute('aria-label')).toBe('Language');
        expect(select.className).toContain('form-select');
    });

    it('reflects a supported language and falls back to EN for an unsupported one', () => {
        render({ lang: 'es' });
        expect(q('landing-language-select').value).toBe('ES');
        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        render({ lang: 'de' });
        expect(q('landing-language-select').value).toBe('EN');
    });

    it('reports the selected language through onLanguageChange', () => {
        const onLanguageChange = vi.fn();
        render({ onLanguageChange });
        const select = q('landing-language-select');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(select, 'ES');
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(onLanguageChange).toHaveBeenCalledTimes(1);
        expect(onLanguageChange).toHaveBeenCalledWith('ES');
    });

    // --- Task 8: carousel on the landing page ---
    it('renders the showcase carousel when showcaseVideos is provided', () => {
        const showcaseVideos = ['a', 'b', 'c'].map((slug) => ({ slug, videoUrl: `${slug}.mp4`, posterUrl: `${slug}.jpg` }));
        render({ showcaseVideos });
        expect(q('showcase-carousel')).not.toBeNull();
        expect(container.querySelectorAll('img[data-testid^="showcase-poster-"]')).toHaveLength(3);
        expect(container.querySelectorAll('video')).toHaveLength(0);
    });

    it('omits the showcase carousel when there are no showcase videos', () => {
        render({ showcaseVideos: [] });
        expect(q('showcase-carousel')).toBeNull();
    });
});
