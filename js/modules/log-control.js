
// Intentional window.enabledLogs — debug/logging utility shared across modules.
// React Native would use a different logging mechanism; this is a web convenience.
const originalConsoleLog = console.log;

window.enabledLogs = {
    whisper: false,
    recording: false,
    speech: false,
    api: false,
    'tanstack query': false,
    toggle: false,
    ai: true,
    analytics: false,
    ui: false,
    hesitation: false,
    success: false,
    scoring: false,
    video: false,
    router: false,
    pipeline: false,
    app: false,
    storage: false,
    gamification: false,
    pointlossoverlay: false,
    store: false,
    pt: false,
    debug: true,
    all: false
};

console.log = (msg, ...args) => {
    if (typeof msg === 'string') {
        const match = msg.match(/^\[(.*?)\]/i);
        if (match) {
            const namespace = match[1].toLowerCase();
            if (window.enabledLogs[namespace]) {
                originalConsoleLog(msg, ...args);
                return;
            }
            if (window.enabledLogs.hasOwnProperty(namespace)) return;
        }
    }
    if (window.enabledLogs.all) {
        originalConsoleLog(msg, ...args);
    }
};
