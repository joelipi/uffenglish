import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { appStore } from '../modules/store/store.js';
import { useNativeLanguage } from './use-native-language.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderLang(fallback) {
    let seen;
    function Probe() {
        seen = fallback === undefined ? useNativeLanguage() : useNativeLanguage(fallback);
        return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    act(() => {
        root.render(React.createElement(Probe));
    });
    act(() => {
        root.unmount();
    });
    return seen;
}

function withStore(guestNativeLanguage, userData, fn) {
    const prev = appStore.getState();
    appStore.setState({ guestNativeLanguage, userData });
    try {
        fn();
    } finally {
        appStore.setState({ guestNativeLanguage: prev.guestNativeLanguage, userData: prev.userData });
    }
}

describe('useNativeLanguage', () => {
    it('returns the store guest language first', () => {
        withStore('FR', { native_language: 'EN' }, () => {
            expect(renderLang()).toBe('FR');
        });
    });

    it('uses the fallback ahead of the store mirror when no guest is set', () => {
        // Friends page: the just-refetched query profile (FR) beats the store
        // mirror (EN) the profile editor has not synced yet.
        withStore(null, { native_language: 'EN' }, () => {
            expect(renderLang('FR')).toBe('FR');
        });
    });

    it('ignores the fallback while a guest choice exists', () => {
        withStore('FR', { native_language: 'EN' }, () => {
            expect(renderLang('PT')).toBe('FR');
        });
    });

    it('falls back to the store profile and then to en', () => {
        withStore(null, { native_language: 'ES' }, () => {
            expect(renderLang()).toBe('ES');
        });
        withStore(null, null, () => {
            expect(renderLang()).toBe('en');
        });
    });
});
