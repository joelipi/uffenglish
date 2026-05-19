// Uses Metro's platform extension resolution (.web.js / .native.jsx).
// No runtime environment checks needed — the bundler picks the right file.
// Web: step-loader.web.js, Native: step-loader.native.jsx (future)

export { loadQuestion } from './step-loader.web.js';
