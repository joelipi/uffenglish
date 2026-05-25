import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';
import { handleAuthClick } from '../../modules/lesson-init.js';

export default function AuthLink() {
    const isLoggedIn = useStore(appStore, (state) => state.isLoggedIn);
    const nativeLang = useStore(appStore, (state) => state.userData?.native_language);

    const text = isLoggedIn
        ? (Strings.get('sign_out', nativeLang) || 'Sign Out')
        : (Strings.get('sign_in', nativeLang) || 'Sign In');

    return (
        <a href="#" onClick={handleAuthClick}>{text}</a>
    );
}
