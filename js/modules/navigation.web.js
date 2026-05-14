// modules/navigation.web.js

export function cleanBrowserUrlRoute() {
    if (typeof window === 'undefined' || !window.history) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('lessonid') || url.searchParams.has('course')) {
        url.searchParams.delete('lessonid');
        url.searchParams.delete('course');
        window.history.replaceState({}, document.title, url.toString());
    }
}

export function navigateToLogin(redirectUrl) {
    if (typeof window !== 'undefined') {
        window.location.href = `login.html?redirect=${encodeURIComponent(redirectUrl)}`;
    }
}

export function navigateToHome() {
    if (typeof window !== 'undefined') {
        window.location.href = 'homescreen.html';
    }
}