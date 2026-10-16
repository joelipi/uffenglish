/**
 * Where the speech model bytes come from.
 *
 * The Whisper engines are the heaviest assets the app loads (quantized ONNX
 * graphs plus the ONNX Runtime WASM binaries), and they are fetched from a
 * different origin than the app shell — so nothing warms that connection
 * unless the document asks for it. `index.html` preconnects
 * WHISPER_MODEL_ORIGIN for exactly this reason; it sits in front of the whole
 * chain (module graph → speech.js top-level preload → worker chunk →
 * bootWhisperEngine), so a missed TLS handshake there delays the model on
 * every cold load.
 *
 * Pure module: no DOM, no fetch. `whisper-model-origin.test.js` asserts the
 * preconnect in index.html and the literals inside both workers all still
 * point here, so moving the CDN re-tunes the head hints instead of silently
 * leaving them aimed at the old host.
 *
 * Note the PWA (sherpa-onnx) worker is a CLASSIC worker — it is constructed
 * without `{ type: 'module' }` — so it cannot `import` this module and keeps
 * its literal; the test is what ties the two together.
 */

/** Origin serving the Whisper models and runtime assets (R2). */
export const WHISPER_MODEL_ORIGIN = 'https://r2.ultrafastfluency.com';

/** Path prefix under that origin. Transformers.js builds `whisper/{model}/…`. */
export const WHISPER_MODEL_PATH = 'whisper/';

/** `WHISPER_MODEL_ORIGIN + '/' + WHISPER_MODEL_PATH`, e.g. the sherpa-onnx base URL. */
export const WHISPER_MODEL_BASE_URL = `${WHISPER_MODEL_ORIGIN}/${WHISPER_MODEL_PATH}`;
