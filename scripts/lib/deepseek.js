// scripts/lib/deepseek.js
// Shared DeepSeek chat client for the caption pipeline and the authoring-sheet
// translator (story 049). This is a pure extraction of the request that used to
// live in `translateReal` (scripts/generate-captions.mjs): the same endpoint,
// model, `response_format: json_object` body, and `Bearer` header. Callers
// inject `fetchImpl` so the transport is testable without the network, and the
// captions path is a drop-in: its captured request body is unchanged.

// The DeepSeek model every translation uses (mirrors caption-utils.js).
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
// The chat-completions endpoint both pipelines POST to.
export const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// The app teaches English, so the target phrase after a "Say:"/"Di:"/"Diga:"
// marker must stay English in every translation. Kept as one constant so both
// prompts carry the exact same instruction.
export const TAUGHT_PHRASE_INSTRUCTION =
    'Keep the taught English target phrase (e.g. after "Say:", "Di:", "Diga:") in English.';

/**
 * POST one chat completion with `response_format: json_object` and return the
 * parsed JSON content. Shared transport for `translateText`/`translateSrt`.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.system system prompt
 * @param {string} opts.user user text
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<object>} the parsed JSON content
 */
export async function deepseekJson({ apiKey, system, user, fetchImpl = fetch }) {
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
    const res = await fetchImpl(DEEPSEEK_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`DeepSeek returned no content: ${text.slice(0, 300)}`);
    return JSON.parse(content);
}

function resolveApiKey(explicit) {
    return explicit ?? process.env.DEEPSEEK_API_KEY;
}

/**
 * Translate a short English string into `lang` (one plain-text cell of the
 * authoring sheet). Returns the translated string.
 *
 * @param {string} text
 * @param {string} lang
 * @param {{fetchImpl?: typeof fetch, apiKey?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function translateText(text, lang, { fetchImpl, apiKey } = {}) {
    const system =
        `You translate English text into ${lang}. ` +
        'Return ONLY a JSON object of the form {"translation": "<translated text>"}. ' +
        'Translate only the text; do not add commentary. ' +
        "Preserve the input's line breaks exactly (keep the same number of lines). " +
        TAUGHT_PHRASE_INSTRUCTION;
    const parsed = await deepseekJson({ apiKey: resolveApiKey(apiKey), system, user: text, fetchImpl });
    if (typeof parsed.translation !== 'string' || parsed.translation.trim() === '') {
        throw new Error('DeepSeek response missing "translation" key');
    }
    // Trim stray surrounding whitespace so it never lands in a sheet cell.
    return parsed.translation.trim();
}

/**
 * Translate an English SRT document into `lang`, preserving cue numbers and
 * timestamps exactly (the captions pipeline's use).
 *
 * @param {string} englishSrt
 * @param {string} lang
 * @param {{fetchImpl?: typeof fetch, apiKey?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function translateSrt(englishSrt, lang, { fetchImpl, apiKey } = {}) {
    const system =
        `You translate English subtitle (SRT) files into ${lang}. ` +
        'Return ONLY a JSON object of the form {"srt": "<translated SRT>"}. ' +
        'Preserve cue numbers and timestamps exactly; translate only the subtitle text. ' +
        TAUGHT_PHRASE_INSTRUCTION;
    const parsed = await deepseekJson({ apiKey: resolveApiKey(apiKey), system, user: englishSrt, fetchImpl });
    if (!parsed.srt) throw new Error('DeepSeek response missing "srt" key');
    return parsed.srt;
}
