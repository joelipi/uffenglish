// scripts/lib/gemini.js
// Shared Gemini translation client for the caption pipeline and the master-CSV
// translator. Calls the OpenAI-compatible endpoint, so the request shape
// mirrors a standard chat-completions call: `model` + `messages[]` +
// `response_format: json_object`, `Bearer` key header. Callers inject
// `fetchImpl` (and `sleepImpl`) so the transport — including the retry loop —
// is testable without the network.
//
// Free-tier note: quota errors (HTTP 429) and transient 5xx are retried with
// backoff because the free tier throttles aggressively on bulk jobs (the
// caller translates sequentially, so one slow cell never fans out). A
// `Retry-After` response header is honored when present, with exponential
// fallback (base 5s, doubling, capped at 60s) and 5 attempts; anything else
// fails loudly with status + body.

// The Gemini model every translation uses (Flash-Lite: translation-optimized,
// free-tier eligible).
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
// The OpenAI-compatible endpoint both pipelines POST to.
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// The app teaches English, so the target phrase after a "Say:"/"Di:"/"Diga:"
// marker must stay English in every translation. Kept as one constant so both
// prompts carry the exact same instruction.
export const TAUGHT_PHRASE_INSTRUCTION =
    'Keep the taught English target phrase (e.g. after "Say:", "Di:", "Diga:") in English.';

// Retryable statuses: quota exhaustion + transient server failures. Anything
// else (400 validation, 401/403 auth, 404 model) fails immediately —
// retrying those can only burn quota.
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
}

const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 5000;
const RETRY_CAP_MS = 60000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from a `Retry-After` header value (delta-seconds form), or null. */
export function retryAfterMs(value) {
    if (value === undefined || value === null) return null;
    const seconds = Number(String(value).trim());
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, RETRY_CAP_MS);
}

/** Backoff before attempt `n` failed (1-based): exponential from 5s, 60s cap. */
export function backoffMs(attempt) {
    return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
}

/**
 * POST one chat completion with `response_format: json_object` and return the
 * parsed JSON content, retrying quota/transient failures. Shared transport
 * for `translateText`/`translateSrt`.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.system system prompt
 * @param {string} opts.user user text
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.maxAttempts] total tries including the first (default 5)
 * @param {(ms: number) => Promise<void>} [opts.sleepImpl] injectable clock
 * @param {(info: {attempt: number, status: number, waitMs: number}) => void} [opts.onRetry] (`status` 0 = transport failure)
 * @returns {Promise<object>} the parsed JSON content
 */
export async function geminiJson({
    apiKey, system, user, fetchImpl = fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS, sleepImpl = defaultSleep, onRetry = () => {},
} = {}) {
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not set');
    let attempt = 0;
    // Header lookup tolerating both shapes: a Headers-like with `.get`
    // (case-insensitive per spec) or a plain object with any casing.
    const headerOf = (response, name) => {
        const headers = response?.headers;
        if (!headers) return undefined;
        if (typeof headers.get === 'function') {
            try { return headers.get(name); } catch { return undefined; }
        }
        const lower = {};
        for (const key of Object.keys(headers)) lower[String(key).toLowerCase()] = headers[key];
        return lower[String(name).toLowerCase()];
    };
    for (;;) {
        attempt++;
        let res;
        let text;
        try {
            res = await fetchImpl(GEMINI_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: GEMINI_MODEL,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                }),
            });
            // Inside the try: a connection that drops after headers
            // (truncated chunked body) retries like any transport blip.
            text = await res.text();
        } catch (err) {
            // Transport failure (DNS reset, dropped connection, truncated
            // body): same backoff as a throttled response — a bulk job must
            // not die on one blip.
            if (attempt >= maxAttempts) {
                throw new Error(`Gemini fetch failed after ${attempt} attempt(s): ${String(err?.message ?? err)}`);
            }
            const waitMs = backoffMs(attempt);
            onRetry({ attempt, status: 0, waitMs });
            await sleepImpl(waitMs);
            continue;
        }
        if (res.ok) {
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(`Gemini returned non-JSON response: ${text.slice(0, 300)}`);
            }
            const content = data.choices?.[0]?.message?.content;
            if (!content) throw new Error(`Gemini returned no content: ${text.slice(0, 300)}`);
            try {
                return JSON.parse(content);
            } catch {
                throw new Error(`Gemini returned non-JSON content: ${content.slice(0, 300)}`);
            }
        }
        if (!isRetryableStatus(res.status) || attempt >= maxAttempts) {
            const tries = `after ${attempt} attempt(s)`;
            throw new Error(`Gemini HTTP ${res.status} ${tries}: ${text.slice(0, 300)}`);
        }
        const waitMs = retryAfterMs(headerOf(res, 'retry-after'))
            ?? backoffMs(attempt);
        onRetry({ attempt, status: res.status, waitMs });
        await sleepImpl(waitMs);
    }
}

function resolveApiKey(explicit) {
    return explicit ?? process.env.GOOGLE_API_KEY;
}

/**
 * Translate a short English string into `lang` (one plain-text cell of the
 * master CSV). Returns the translated string.
 *
 * @param {string} text
 * @param {string} lang
 * @param {{fetchImpl?: typeof fetch, apiKey?: string, sleepImpl?: Function, onRetry?: Function}} [opts]
 * @returns {Promise<string>}
 */
export async function translateText(text, lang, { fetchImpl, apiKey, sleepImpl, onRetry } = {}) {
    const system =
        `You translate English text into ${lang}. ` +
        'Return ONLY a JSON object of the form {"translation": "<translated text>"}. ' +
        'Translate only the text; do not add commentary. ' +
        "Preserve the input's line breaks exactly (keep the same number of lines). " +
        TAUGHT_PHRASE_INSTRUCTION;
    const parsed = await geminiJson({ apiKey: resolveApiKey(apiKey), system, user: text, fetchImpl, sleepImpl, onRetry });
    if (typeof parsed.translation !== 'string' || parsed.translation.trim() === '') {
        throw new Error('Gemini response missing "translation" key');
    }
    // Trim stray surrounding whitespace so it never lands in a CSV cell.
    return parsed.translation.trim();
}

/**
 * Translate an English SRT document into `lang`, preserving cue numbers and
 * timestamps exactly (the captions pipeline's use).
 *
 * @param {string} englishSrt
 * @param {string} lang
 * @param {{fetchImpl?: typeof fetch, apiKey?: string, sleepImpl?: Function, onRetry?: Function}} [opts]
 * @returns {Promise<string>}
 */
export async function translateSrt(englishSrt, lang, { fetchImpl, apiKey, sleepImpl, onRetry } = {}) {
    const system =
        `You translate English subtitle (SRT) files into ${lang}. ` +
        'Return ONLY a JSON object of the form {"srt": "<translated SRT>"}. ' +
        'Preserve cue numbers and timestamps exactly; translate only the subtitle text. ' +
        TAUGHT_PHRASE_INSTRUCTION;
    const parsed = await geminiJson({ apiKey: resolveApiKey(apiKey), system, user: englishSrt, fetchImpl, sleepImpl, onRetry });
    // An empty SRT document is meaningless downstream (and the old client
    // rejected it), so fail loudly like translateText does for blank text.
    if (typeof parsed.srt !== 'string' || parsed.srt.trim() === '') {
        throw new Error('Gemini response missing "srt" key');
    }
    return parsed.srt;
}
