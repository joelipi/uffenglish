// Every signup form shows the localized legal consent boilerplate ("By
// signing up, I accept the Terms of Service and acknowledge the Privacy
// Policy") with each phrase linked to its policy. These render the real DOM
// (no source guards) per the story-050 precedent in signup-legal-links.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import SignupConsent from './SignupConsent.jsx';
import SaveClipsSignupForm from '../modals/SaveClipsSignupForm.jsx';
import SignupForm from '../auth/SignupForm.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** True when `other` comes after `node` in document order. */
function comesAfter(node, other) {
    return Boolean(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const SENTENCES = {
    en: 'By signing up, I accept the Terms of Service and acknowledge the Privacy Policy.',
    es: 'Al registrarme, acepto los Términos del Servicio y reconozco la Política de Privacidad.',
    pt: 'Ao me cadastrar, aceito os Termos de Serviço e reconheço a Política de Privacidade.',
    fr: "En m'inscrivant, j'accepte les Conditions d'utilisation et je reconnais la Politique de confidentialité.",
    hi: 'साइन अप करके, मैं सेवा की शर्तें और गोपनीयता नीति से सहमत हूँ।',
    bn: 'সাইন আপ করে, আমি সেবার শর্তাবলী এবং গোপনীয়তা নীতি মেনে চলতে সম্মত আছি।',
};

describe('signup consent boilerplate', () => {
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

    const render = (element) => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null, element)
            );
        });
    };

    it.each(Object.entries(SENTENCES))('renders the exact localized sentence for %s', (lang, expected) => {
        render(React.createElement(SignupConsent, { lang }));

        const consent = container.querySelector('[data-testid="signup-consent"]');
        expect(consent).not.toBeNull();
        expect(consent.textContent).toBe(expected);
    });

    it('links each phrase to its own policy in a new tab', () => {
        render(React.createElement(SignupConsent, { lang: 'en' }));

        const links = [...container.querySelectorAll('[data-testid="signup-consent"] a')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['/terms', '/privacy']);
        expect(links.map((a) => a.textContent)).toEqual(['Terms of Service', 'Privacy Policy']);
        for (const a of links) {
            expect(a.getAttribute('target')).toBe('_blank');
            expect(a.getAttribute('rel')).toContain('noopener');
        }
    });

    it.each([
        ['SignupForm (/signup)', SignupForm],
        ['SaveClipsSignupForm (save-clips modal)', SaveClipsSignupForm],
    ])('%s shows the consent after the form and outside it', (_name, Component) => {
        render(React.createElement(Component));

        const consent = container.querySelector('[data-testid="signup-consent"]');
        expect(consent).not.toBeNull();

        const form = container.querySelector('form');
        expect(form).not.toBeNull();
        expect(form.contains(consent)).toBe(false);
        expect(comesAfter(form, consent)).toBe(true);

        expect([...consent.querySelectorAll('a')].map((a) => a.getAttribute('href')))
            .toEqual(['/terms', '/privacy']);
    });
});
