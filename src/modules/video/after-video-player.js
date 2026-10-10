// Platform shim — mirrors video-processor.js. Extensionless imports resolve
// this file, letting the bundler pick the platform implementation
// (.web.js on web via vite, .native on React Native via Metro).
export * from './after-video-player.web.js';
