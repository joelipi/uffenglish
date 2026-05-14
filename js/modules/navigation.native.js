// This will eventually use Expo Router hooks like `router.push('/login')`

export function cleanBrowserUrlRoute() {
    // No-op on native. Deep-link parameters are handled by Expo Router.
}

export function navigateToLogin(redirectUrl) {
    console.log(`[Native Navigation] Would navigate to login with redirect: ${redirectUrl}`);
}

export function navigateToHome() {
    console.log(`[Native Navigation] Would navigate to home`);
}