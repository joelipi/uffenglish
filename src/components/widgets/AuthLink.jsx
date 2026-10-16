import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function AuthLink({ onAuthClick }) {
    const isLoggedIn = useStore(appStore, (state) => state.isLoggedIn);
    const nativeLang = useNativeLanguage();

    const text = isLoggedIn
        ? (Strings.get('sign_out', nativeLang) || 'Sign Out')
        : (Strings.get('sign_in', nativeLang) || 'Sign In');

    return (
        <a href="#" onClick={onAuthClick}>{text}</a>
    );
}
