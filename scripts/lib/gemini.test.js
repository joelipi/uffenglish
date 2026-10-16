// scripts/lib/gemini.test.js
// The shared Gemini client: transport pins (URL/model/json_object/Bearer),
// the taught-English-target-phrase instruction, and the free-tier retry loop
// (429/5xx wait-and-resubmit with Retry-After + exponential backoff; anything
// else fails immediately).
import { describe, it, expect, vi } from 'vitest';
import {
    GEMINI_MODEL,
    GEMINI_URL,
    geminiJson,
    retryAfterMs,
    translateText,
    translateSrt,
    translateBatchStrings,
    translateBatchSrts,
} from './gemini.js';

// A fetch stub that records the request and returns a single JSON content blob.
function stubFetch(content, { ok = true, status = 200, headers = {} } = {}) {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
        calls.push({ url, init });
        return {
            ok,
            status,
            headers,
            text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        };
    });
    return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('geminiJson transport', () => {
    it('POSTs the model, json_object response format, and Bearer header', async () => {
        const { fetchImpl, calls } = stubFetch({ ok: true });
        await geminiJson({ apiKey: 'k', system: 'sys', user: 'usr', fetchImpl });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(GEMINI_URL);
        expect(GEMINI_URL).toContain('generativelanguage.googleapis.com');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers.Authorization).toBe('Bearer k');
        expect(calls[0].init.headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(calls[0].init.body);
        expect(body.model).toBe(GEMINI_MODEL);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages).toEqual([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'usr' },
        ]);
    });

    it('throws when the API key is absent', async () => {
        await expect(geminiJson({ apiKey: '', system: 's', user: 'u', fetchImpl: () => {} }))
            .rejects.toThrow(/GOOGLE_API_KEY/);
    });

    it('throws immediately on a non-retryable status', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad request' }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl: noSleep }))
            .rejects.toThrow(/Gemini HTTP 400/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('throws with context when the response body is not JSON', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl }))
            .rejects.toThrow(/Gemini returned non-JSON response/);
    });

    it('throws with context when the model content is not JSON', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
        }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl }))
            .rejects.toThrow(/Gemini returned non-JSON content/);
    });
});

describe('geminiJson retry (free-tier throttling)', () => {
    const okBlob = (content) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    });

    it('retries a 429 then succeeds, honoring Retry-After', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls++;
            if (calls === 1) return { ok: false, status: 429, headers: { 'retry-after': '7' }, text: async () => 'slow down' };
            return okBlob({ ok: true });
        });
        const out = await geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl });
        expect(out).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(waits).toEqual([7000]);
    });

    it('backs off exponentially without Retry-After, capped at 60s', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'busy' }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl, maxAttempts: 4 }))
            .rejects.toThrow(/Gemini HTTP 503/);
        expect(fetchImpl).toHaveBeenCalledTimes(4);
        expect(waits).toEqual([5000, 10000, 20000]);
    });

    it('stops after maxAttempts and reports the last status', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'slow' }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl: noSleep, maxAttempts: 2 }))
            .rejects.toThrow(/Gemini HTTP 429/);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('retries a dropped connection, then succeeds', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls++;
            if (calls === 1) throw new Error('socket hang up');
            return okBlob({ ok: true });
        });
        const seen = [];
        const out = await geminiJson({
            apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl,
            onRetry: (info) => seen.push(info),
        });
        expect(out).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(waits).toEqual([5000]);
        expect(seen).toEqual([{ attempt: 1, status: 0, waitMs: 5000 }]);
    });

    it('retries a body that drops after headers, then succeeds', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls++;
            if (calls === 1) {
                return { ok: true, status: 200, text: async () => { throw new Error('socket hang up'); } };
            }
            return okBlob({ ok: true });
        });
        const out = await geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl });
        expect(out).toEqual({ ok: true });
        expect(waits).toEqual([5000]);
    });

    it('gives up on repeated transport failures with an attempt count', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('DNS reset'); });
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl: noSleep, maxAttempts: 2 }))
            .rejects.toThrow(/after 2 attempt\(s\): DNS reset/);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('caps exponential backoff at 60s', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'busy' }));
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl, maxAttempts: 7 }))
            .rejects.toThrow(/Gemini HTTP 503/);
        expect(fetchImpl).toHaveBeenCalledTimes(7);
        expect(waits).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    });

    it('reports each retry through onRetry', async () => {
        const seen = [];
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls++;
            if (calls === 1) return { ok: false, status: 429, text: async () => 'slow' };
            return okBlob({ ok: true });
        });
        await geminiJson({
            apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl: noSleep,
            onRetry: (info) => seen.push(info),
        });
        expect(seen).toEqual([{ attempt: 1, status: 429, waitMs: 5000 }]);
    });

    it('reads a Title-cased plain-object Retry-After', async () => {
        const waits = [];
        const sleepImpl = vi.fn(async (ms) => { waits.push(ms); });
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls++;
            if (calls === 1) return { ok: false, status: 429, headers: { 'Retry-After': '4' }, text: async () => 'slow' };
            return okBlob({ ok: true });
        });
        await geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl });
        expect(waits).toEqual([4000]);
    });

    it('retryAfterMs parses delta-seconds, caps, and rejects garbage', () => {
        expect(retryAfterMs('7')).toBe(7000);
        expect(retryAfterMs('120')).toBe(60000);
        expect(retryAfterMs('abc')).toBeNull();
        expect(retryAfterMs(undefined)).toBeNull();
    });
});

describe('translateText', () => {
    it('returns the parsed translation and carries the taught-phrase instruction', async () => {
        const { fetchImpl, calls } = stubFetch({ translation: 'Hola' });
        const out = await translateText('Hello', 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toBe('Hola');
        const body = JSON.parse(calls[0].init.body);
        const system = body.messages[0].content;
        expect(system).toContain('Say:');
        expect(system).toContain('Di:');
        expect(system).toContain('Diga:');
        expect(system).toContain('in English');
        expect(system).toMatch(/line breaks/i);
        expect(body.messages[1].content).toBe('Hello');
    });

    it('trims stray surrounding whitespace from the returned translation', async () => {
        const { fetchImpl } = stubFetch({ translation: '  Hola  ' });
        expect(await translateText('Hello', 'es', { fetchImpl, apiKey: 'k' })).toBe('Hola');
    });

    it('throws when the response omits the translation key', async () => {
        const { fetchImpl } = stubFetch({ nope: true });
        await expect(translateText('Hello', 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow(/translation/);
    });
});

describe('translateSrt (captions path, no behavior change)', () => {
    it('captures the exact request body for one language', async () => {
        const englishSrt = '1\n00:00:00,500 --> 00:00:03,000\nHello';
        const { fetchImpl, calls } = stubFetch({ srt: 'translated' });
        const out = await translateSrt(englishSrt, 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toBe('translated');
        const expected = {
            model: 'gemini-3.5-flash-lite',
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content:
                        'You translate English subtitle (SRT) files into es. ' +
                        'Return ONLY a JSON object of the form {"srt": "<translated SRT>"}. ' +
                        'Preserve cue numbers and timestamps exactly; translate only the subtitle text. ' +
                        'Keep the taught English target phrase (e.g. after "Say:", "Di:", "Diga:") in English.',
                },
                { role: 'user', content: englishSrt },
            ],
        };
        expect(JSON.parse(calls[0].init.body)).toEqual(expected);
    });

    it('throws when the response omits the srt key', async () => {
        const { fetchImpl } = stubFetch({ translation: 'x' });
        await expect(translateSrt('1\n...', 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow(/srt/);
    });

    it('throws on an empty or whitespace-only srt like on missing', async () => {
        for (const srt of ['', '   ']) {
            const { fetchImpl } = stubFetch({ srt });
            await expect(translateSrt('1\n...', 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow(/srt/);
        }
    });

    it('throws a readable message on a non-Error rejection', async () => {
        const fetchImpl = vi.fn(async () => { throw 'string blowup'; });
        await expect(geminiJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl, sleepImpl: noSleep, maxAttempts: 1 }))
            .rejects.toThrow(/string blowup/);
    });
});


describe('translateBatchStrings (batches one request)', () => {
    it('sends a single request and parses the array, preserving order', async () => {
        const content = { translations: ['Hola', 'Adios'] };
        const { fetchImpl, calls } = stubFetch(content);
        const out = await translateBatchStrings(['Hello', 'Bye'], 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toEqual(['Hola', 'Adios']);
        expect(calls).toHaveLength(1);
        // Single request payload carries both texts as a JSON array.
        const body = JSON.parse(calls[0].init.body);
        const user = JSON.parse(body.messages[1].content);
        expect(user).toEqual(['Hello', 'Bye']);
    });

    it('rejects a length mismatch (no silent drop)', async () => {
        const { fetchImpl } = stubFetch({ translations: ['Hola'] });
        await expect(translateBatchStrings(['Hello','Bye'], 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow();
    });

    it('rejects empty inner strings', async () => {
        const { fetchImpl } = stubFetch({ translations: ['Hola',''] });
        await expect(translateBatchStrings(['Hello','Bye'], 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow(/non-empty/);
    });

    it('returns empty array for empty input without a network call', async () => {
        const fetchImpl = vi.fn();
        const out = await translateBatchStrings([], 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('translateBatchSrts', () => {
    it('returns one SRT per input, single request', async () => {
        const english = '1\n00:00:00,000 --> 00:00:01,000\nHi\n';
        const translated = english.replace('Hi', 'Hola');
        const { fetchImpl, calls } = stubFetch({ translations: [translated] });
        const out = await translateBatchSrts([english], 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toEqual([translated.trim()]);
        expect(calls).toHaveLength(1);
    });

    it('rejects an empty output SRT', async () => {
        const { fetchImpl } = stubFetch({ translations: [''] });
        await expect(translateBatchSrts(['1\n...'], 'es', { fetchImpl, apiKey: 'k' })).rejects.toThrow();
    });
});
