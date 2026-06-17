import { env } from "@huggingface/transformers";
import { isIOS } from "./detectIOS.js";

/**
 * Apply iOS workaround for NLP worker (grammar correction, zero-shot).
 * The demo whisper worker handles ORT configuration directly — this
 * function is only used by nlp-worker-web.js.
 */
export function applyIOSWorkaround(postDiag) {
  if (!isIOS()) return;

  const diag = function(msg) {
    (postDiag || function(m) { self.postMessage({ type: 'diag', message: m }); })('[iOS] ' + msg);
  };

  diag("numThreads -> 1");
  env.backends.onnx.wasm.numThreads = 1;
}
