// Module-level refs for callbacks consumed by React components,
// avoiding the store callback anti-pattern.

let _textInputSubmitCallback = null;
let _speechInputToggleCallback = null;
let _speechEngineRetryCallback = null;
let _callbackVersion = 0;

export function setTextInputSubmitCallback(cb) {
    _textInputSubmitCallback = cb;
    _callbackVersion++;
}

export function getTextInputSubmitCallback() {
    return _textInputSubmitCallback;
}

export function setSpeechInputToggleCallback(cb) {
    _speechInputToggleCallback = cb;
    _callbackVersion++;
}

export function getSpeechInputToggleCallback() {
    return _speechInputToggleCallback;
}

export function setSpeechEngineRetryCallback(cb) {
    _speechEngineRetryCallback = cb;
    _callbackVersion++;
}

export function getSpeechEngineRetryCallback() {
    return _speechEngineRetryCallback;
}

export function getCallbackVersion() {
    return _callbackVersion;
}
