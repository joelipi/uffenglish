// Uses Metro's platform extension resolution (.web.js / .native.jsx).
// No runtime environment checks needed — the bundler picks the right file.
// Web: screen-loader.web.js, Native: screen-loader.native.jsx (future)

export { loadScreen } from './screen-loader.web.js';
