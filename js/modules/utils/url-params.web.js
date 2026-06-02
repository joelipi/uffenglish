export function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

export function getAppOrigin() {
    return window.location.origin;
}
