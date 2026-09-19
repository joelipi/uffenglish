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
    // Deliberately does NOT bump _callbackVersion: that version signals
    // "new step loaded, clear the answer input", and re-registering the
    // retry handler mid-lesson must not wipe what the user typed.
    _speechEngineRetryCallback = cb;
}

export function getSpeechEngineRetryCallback() {
    return _speechEngineRetryCallback;
}

export function getCallbackVersion() {
    return _callbackVersion;
}
