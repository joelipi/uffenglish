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
        expect(q('share-code-headline').textContent).toBe('Practice speaking English with your friends free forever.');
        expect(q('hero-subheading').textContent).toBe("Even if your friends are offline now, no matter your different English levels.");
        expect(q('hero-subheading').className).toContain('uff-hero-sub');
        expect(q('share-code-subheadline').textContent).toBe("Enter your friend's code or start fresh if you don't have one.");
        expect(q('share-code-go').textContent).toBe("Start with friend's code");
        expect(q('no-code').textContent).toBe("Start without friend's code");
        expect(q('landing-account-link').getAttribute('href')).toBe('/login');
        expect(q('landing-account-link').textContent).toBe('Sign In');
    });

    it('renders the Privacy/Terms footer on the public homepage', () => {
        // The public homepage (/) keeps its legal footer; the dashboard
        // (/home) renders none — see legal-wiring.test.js.
        render();
        const footer = container.querySelector('[data-testid="legal-footer"]');
        expect(footer).not.toBeNull();
        expect(footer.tagName).toBe('FOOTER');
        const hrefs = [...footer.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(['/privacy', '/terms']);
    });

    it('links a logged-in visitor to /home with the Home label', () => {
        render({ isLoggedIn: true });
        expect(q('landing-account-link').getAttribute('href')).toBe('/home');
        expect(q('landing-account-link').textContent).toBe('Home');
    });

    it('localizes the headline and Go button', () => {
        render({ lang: 'es' });
        expect(q('share-code-headline').textContent).toBe('Practica hablar inglés con tus amigos gratis para siempre.');
        expect(q('hero-subheading').textContent).toBe('Aunque tus amigos estén desconectados ahora, sin importar sus diferentes niveles de inglés.');
        expect(q('share-code-go').textContent).toBe('Empezar con el código de un amigo');
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
    it('renders a Bootstrap page in the scoped app palette shell', () => {
        render();
        const rootEl = container.firstChild;
        // The scope class is what the real Bootstrap 5.3.8 stylesheet lives
        // under (see home-landing.css / the wiring guard).
        expect(rootEl.className).toBe('uff-home-bs');
        expect(q('landing-topbar').className).toContain('navbar');
        expect(q('share-code-card').className).toContain('card');
        // Bootstrap grid: the hero and each section are container > row > col.
        const hero = q('share-code-headline').closest('.container');
        expect(hero.querySelectorAll('.row')).toHaveLength(1);
        expect(hero.querySelectorAll('[class*="col-lg-"]')).toHaveLength(1);
        expect(q('how-it-works').querySelectorAll('[data-testid^="how-it-works-item-"]')).toHaveLength(11);
        expect(q('about-teacher').querySelectorAll('[class*="col-lg-"]')).toHaveLength(2);
        expect(q('share-code-input').className).toContain('form-control');
    });

    it('styles the Go button as the app white primary', () => {
        render();
        const go = q('share-code-go');
        expect(go.tagName).toBe('BUTTON');
        expect(go.getAttribute('type')).toBe('submit');
        expect(go.className).toContain('btn-uff-primary');
        expect(go.className).toContain('btn-lg');
    });

    it('styles both start options as equal-weight primary buttons with no sub-headings', () => {
        render();
        const noCode = q('no-code');
        expect(noCode.tagName).toBe('BUTTON');
        expect(noCode.getAttribute('type')).toBe('button');
        expect(noCode.className).toContain('btn-uff-primary');
        expect(noCode.className).toContain('btn-lg');
        expect(noCode.className).toContain('w-100');
        const go = q('share-code-go');
        expect(go.className).toContain('btn-uff-primary');
        expect(go.className).toContain('btn-lg');
        expect(go.className).toContain('w-100');
        expect(q('start-option-divider')).toBeNull();
        expect(q('have-code-title')).toBeNull();
        expect(q('fresh-start-title')).toBeNull();
    });

    it('keeps the top-bar sign-in visible on the gradient navbar', () => {
        render();
        const link = q('landing-account-link');
        expect(link).not.toBeNull();
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('href')).toBe('/login');
        expect(link.textContent).toBe('Sign In');
        expect(link.className).toContain('btn-uff-topbar');
    });

    // --- Task 2: "How it works" section ---
    it('renders the How it works section with eleven headed rows', () => {
        render();
        expect(q('how-it-works')).not.toBeNull();
        const list = q('how-it-works-list');
        expect(list.getAttribute('role')).toBe('list');
        // The section heading was removed; a code comment marks the section.
        expect(q('how-it-works-heading')).toBeNull();
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => q(`how-it-works-item-${n}`));
        expect(items.every(Boolean)).toBe(true);
        expect(list.querySelectorAll('[data-testid^="how-it-works-item-"]')).toHaveLength(11);
        const expected = [
            'no subscription, no card needed, ever.',
            'Each lesson teaches multiple forms of the same basic questions and answers, from a very beginner way to an advanced way. For instance, very beginner: "Coffee or tea?" Intermediate: "Would you like coffee or tea?" Advanced: "Would you prefer a steaming mug of fresh-brewed Arabica coffee or a nice cup of tea?"',
            "You don't need to be online at the same time as your friends.",
            "Find out what you said right or wrong. You have an infinite number of attempts to get it right, no pressure.",
            'Each lesson can be completed in less than 5 minutes.',
            'This is never-before-seen technology and a radically different paradigm from the thousands of multiple-choice "gamified" apps that don\'t really teach you how to speak.',
            'These are time-tested speaking exercises updated with revolutionary technology.',
            "Re-record yourself as many times as you like. There's no classroom full of people to feel embarrassed in front of.",
            'Ask your friends crazy questions, role play, play trivia games, or even tell jokes!',
            'At the end of each lesson you get a special video of you and your friend you can share publicly or keep forever.',
            "You're not just practicing English, you're renewing acquaintances and deepening relationships. And you're seeing real progress in speaking English.",
        ];
        const titles = {
            1: '100% free',
            2: 'Any English level',
            3: 'Practice anytime, anywhere',
            4: 'Instant feedback on your speaking',
            5: 'UFF stands for Ultra Fast Fluency in English',
            6: "Unlike anything you've ever tried before.",
            7: 'It works!',
            8: 'Gain confidence in speaking.',
            9: "It's fun!",
            10: 'Get rewarded.',
            11: 'Stay motivated.',
        };
        items.forEach((row, i) => {
            const n = i + 1;
            expect(row.className).toContain('row');
            expect(row.className).toContain('uff-how-row');
            expect(row.getAttribute('role')).toBe('listitem');
            const icon = row.querySelector('.uff-how-icon');
            expect(icon).not.toBeNull();
            expect(icon.className).toMatch(/bi-/);
            const title = row.querySelector(`[data-testid="how-it-works-title-${n}"]`);
            expect(title).not.toBeNull();
            expect(title.tagName).toBe('H3');
            expect(title.textContent).toBe(titles[n]);
            const span = row.querySelector('span');
            expect(span).not.toBeNull();
            expect(span.textContent).toBe(expected[i]);
        });
    });

    it('italicizes Fast in the UFF expansion title without injecting HTML', () => {
        render();
        const title = q('how-it-works-title-5');
        const em = title.querySelector('i');
        expect(em).not.toBeNull();
        expect(em.textContent).toBe('Fast');
        expect(title.textContent).toBe('UFF stands for Ultra Fast Fluency in English');
        expect(title.innerHTML).not.toContain('&lt;');
    });

    it('localizes the How it works section', () => {
        render({ lang: 'es' });
        expect(q('how-it-works-item-1').querySelector('span').textContent)
            .toBe('sin suscripción, no se necesita tarjeta, nunca.');
        expect(q('how-it-works-title-1').textContent).toBe('100% gratis');
        expect(q('how-it-works-title-2').textContent).toBe('Cualquier nivel de inglés');
        expect(q('how-it-works-title-3').textContent).toBe('Practica cuando quieras, donde quieras');
        expect(q('how-it-works-title-4').textContent).toBe('Comentarios instantáneos sobre tu habla');
        expect(q('how-it-works-title-6').textContent).toBe('Algo que nunca has probado.');
    });

    it('alternates the giant icon left/right across How-it-works rows', () => {
        render();
        const ns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        const icons = ns.map((n) => q(`how-it-works-item-${n}`).querySelector('.uff-how-icon'));
        expect(icons.every(Boolean)).toBe(true);
        const iconCols = ns.map((n) => q(`how-it-works-item-${n}`).querySelector('.uff-how-icon').closest('[class*="col-"]'));
        iconCols.forEach((col, i) => {
            if (i % 2 === 0) expect(col.className).not.toContain('order-md-2');
            else expect(col.className).toContain('order-md-2');
        });
    });

    it('gives the showcase carousel the brand blue gradient background', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('src/components/homescreen/home-landing.css', 'utf8');
        const start = css.indexOf('.uff-showcase-gradient');
        expect(start).toBeGreaterThan(-1);
        expect(css.slice(start, start + 800)).toContain('rgba(58, 143, 213, 1)');
        expect(css.slice(start, start + 800)).toContain('rgba(0, 192, 216, 1)');
    });

    it('never pulses from the homepage stylesheet', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('src/components/homescreen/home-landing.css', 'utf8');
        expect(css).not.toContain('btnGlowPulse');
    });

    it('uses the in-app simple-video play triangle on carousel slides', () => {
        const showcaseVideos = ['a'].map((slug) => ({ slug, videoUrl: `${slug}.mp4`, posterUrl: `${slug}.jpg` }));
        render({ showcaseVideos });
        const icon = q('showcase-play-a').querySelector('svg.uff-carousel-play-icon');
        expect(icon).not.toBeNull();
        expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(icon.getAttribute('fill')).toBe('white');
        expect(icon.querySelector('path').getAttribute('d')).toBe('M8 5v14l11-7z');
    });

    it('keeps the top-bar controls compact', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('src/components/homescreen/home-landing.css', 'utf8');
        const topbar = css.slice(css.indexOf('.uff-home-bs .btn-uff-topbar {'), css.indexOf('}', css.indexOf('.uff-home-bs .btn-uff-topbar {')) + 1);
        expect(topbar).toContain('font-size: 0.8rem');
        const select = css.slice(css.indexOf('.uff-navbar .form-select-sm {'), css.indexOf('}', css.indexOf('.uff-navbar .form-select-sm {')) + 1);
        expect(select).toContain('font-size: 0.8rem');
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
        expect(photo.className).toContain('uff-teacher-photo');
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
        expect(options.map((o) => o.textContent)).toEqual([
            'English',
            'Español',
            'Português',
            'Français',
            'हिन्दी',
            'বাংলা',
        ]);
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

    it('renders the any-device section with icons above the text', () => {
        render();
        const section = q('any-device');
        expect(section).not.toBeNull();
        expect(section.className).toContain('uff-showcase-gradient');
        const icons = q('any-device-icons');
        expect(icons).not.toBeNull();
        for (const name of ['smartphone', 'laptop', 'tablet']) {
            const icon = q(`any-device-icon-${name}`);
            expect(icon).not.toBeNull();
            expect(icon.querySelector('i.bi')).not.toBeNull();
            // No visible brand-name captions; the accessible name carries it.
            expect(icon.querySelector('span')).toBeNull();
            expect(icon.getAttribute('aria-label')).toBeTruthy();
        }
        // Icons come before the heading and body in DOM order.
        expect(section.innerHTML.indexOf('any-device-icons')).toBeLessThan(section.innerHTML.indexOf('any-device-heading'));
        expect(q('any-device-heading').textContent).toBe('Anywhere, Any Device.');
        expect(q('any-device-text').textContent).toBe("It works on any recent device (since about 2020): phone, tablet, or computer. You don't even have to install an app!");
    });

    it('keeps the top bar on a single line at any width', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('src/components/homescreen/home-landing.css', 'utf8');
        const at = css.indexOf('.uff-navbar .container {');
        expect(at, 'missing navbar nowrap rule').toBeGreaterThan(-1);
        expect(css.slice(at, css.indexOf('}', at) + 1)).toContain('flex-wrap: nowrap');
    });

    it('repeats the share-code entry at the bottom with working controls', () => {
        const onSubmitCode = vi.fn();
        const onNoCode = vi.fn();
        render({ onSubmitCode, onNoCode });
        expect(q('bottom-cta')).not.toBeNull();
        expect(q('share-code-card-bottom')).not.toBeNull();
        expect(q('share-code-subheadline-bottom').textContent)
            .toBe(q('share-code-subheadline').textContent);
        expect(q('share-code-go-bottom').textContent).toBe("Start with friend's code");
        expect(q('no-code-bottom').textContent).toBe("Start without friend's code");
        act(() => { q('no-code-bottom').click(); });
        expect(onNoCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).not.toHaveBeenCalled();
        const input = q('share-code-input-bottom');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'xyz');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            q('share-code-go-bottom').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(onSubmitCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).toHaveBeenCalledWith('xyz');
    });
});
