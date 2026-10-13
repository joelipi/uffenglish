// components/pwa/pwa-install-contract.test.jsx
// Unmocked contract check against the real `@khmyznikov/pwa-install` package.
// `pwa-install-wiring.test.jsx` mocks the package (so the home-screen subtree
// stays light in jsdom), which means no test there ever touches the real
// component contract this feature sits on. This file imports the real bundle,
// upgrades a real `<pwa-install>` element, and pins the attribute/property
// bindings the app relies on — so a rename in a future package bump fails here
// instead of shipping a silently inert dialog.
//
// The element is created but never connected to the document, so the
// component's `connectedCallback` (manifest fetch, platform detection) never
// runs; only Lit's attribute reflection is exercised.
import { describe, it, expect } from 'vitest';
import '@khmyznikov/pwa-install';

describe('real pwa-install component contract', () => {
    it('registers the pwa-install custom element on import', () => {
        expect(customElements.get('pwa-install')).toBeTruthy();
    });

    it('reflects the manual-mode and storage attributes the app sets', () => {
        const element = document.createElement('pwa-install');
        element.setAttribute('manual-apple', 'true');
        element.setAttribute('manual-chrome', 'true');
        element.setAttribute('use-local-storage', 'true');
        element.setAttribute('manifest-url', '/manifest.webmanifest');
        expect(element.manualApple).toBe(true);
        expect(element.manualChrome).toBe(true);
        expect(element.useLocalStorage).toBe(true);
        expect(element.manifestUrl).toBe('/manifest.webmanifest');
    });

    it('exposes the showDialog/hideDialog methods the entry point calls', () => {
        const element = document.createElement('pwa-install');
        expect(typeof element.showDialog).toBe('function');
        expect(typeof element.hideDialog).toBe('function');
        expect(typeof element.install).toBe('function');
    });
});
