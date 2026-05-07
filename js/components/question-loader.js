// Uses Metro's platform extension resolution (.web.js / .native.jsx).
// No runtime environment checks needed — the bundler picks the right file.
// Web: question-loader.web.js, Native: question-loader.native.jsx (future)

export { loadQuestion } from './question-loader.web.js';
