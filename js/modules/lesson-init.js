// --- modules/lesson-init.js ---
// Leaf initialization functions extracted from app.js.
// Heavier functions (initializeApp, initializeLesson, loadLessonContent)
// remain in app.js due to tight coupling with answer pipeline and progression.

import { appStore } from './store.js';
import { isUserLoggedIn, signOut } from './api.js';
import Strings from '../data/strings.js';
import { bindAuthMenuUI } from '../components/ui.js';
import { navigateToHome, navigateToLogin } from './navigation.js';

export async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        let isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
            isPersisted = await navigator.storage.persist();
        }
        if (isPersisted) {
            console.log("  Storage is persistent. The browser will not auto-delete the GECToR models.");
        } else {
            console.warn("  Persistent storage not granted. Models may be cleared if the device runs low on space.");
        }
    }
}

export async function handleAuthClick(e) {
    e.preventDefault();
    const isLoggedIn = await isUserLoggedIn();
    if (isLoggedIn) {
        if (confirm('Are you sure you want to sign out?')) {
            await signOut();
            navigateToHome();
        }
    } else {
        const currentUrl = window.location.pathname + window.location.search;
        navigateToLogin(currentUrl);
    }
}

export function setupAuthMenu(isLoggedIn) {
    const signOutText = Strings.get('sign_out', appStore.getState().userData?.native_language) || 'Sign Out';
    const signInText = Strings.get('sign_in', appStore.getState().userData?.native_language) || 'Sign In';
    bindAuthMenuUI(isLoggedIn, handleAuthClick, signOutText, signInText);
}
