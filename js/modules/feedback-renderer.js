// Uses Metro's platform extension resolution (.web.js / .native.js).
// No runtime environment checks needed — the bundler picks the right file.
// Web: feedback-renderer-web.js, Native: feedback-renderer.native.jsx (future)

export * from './feedback-renderer.web.js';
