// Pure redirect-timing decisions for the confirm-email page. Kept out of the
// component so the countdown/redirect rule is unit-testable and platform
// independent.
export const REDIRECT_SECONDS = 3;

export function initialCountdown() {
    return REDIRECT_SECONDS;
}

// Returns the next countdown value given the current one. A value <= 0 means
// the redirect should fire.
export function nextCountdown(current) {
    if (current === null || current === undefined) return null;
    return current - 1;
}

export function shouldRedirect(next) {
    return next !== null && next !== undefined && next <= 0;
}
