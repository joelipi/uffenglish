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
