// scripts/lib/deepseek.test.js
// Story 049, Task 2: the shared DeepSeek client is a pure extraction of the
// captions request. These tests pin the transport (URL/model/json_object/Bearer)
// and the taught-English-target-phrase instruction, and prove the caption
// request body is byte-identical to the pre-refactor `translateReal` body.
import { describe, it, expect, vi } from 'vitest';
import {
    DEEPSEEK_MODEL,
    DEEPSEEK_URL,
    deepseekJson,
    translateText,
    translateSrt,
} from './deepseek.js';

// A fetch stub that records the request and returns a single JSON content blob.
function stubFetch(content, { ok = true, status = 200 } = {}) {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
        calls.push({ url, init });
        return {
            ok,
            status,
            text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        };
    });
    return { fetchImpl, calls };
}

describe('deepseekJson transport', () => {
    it('POSTs the model, json_object response format, and Bearer header', async () => {
        const { fetchImpl, calls } = stubFetch({ ok: true });
        await deepseekJson({ apiKey: 'k', system: 'sys', user: 'usr', fetchImpl });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(DEEPSEEK_URL);
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers.Authorization).toBe('Bearer k');
        expect(calls[0].init.headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(calls[0].init.body);
        expect(body.model).toBe(DEEPSEEK_MODEL);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages).toEqual([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'usr' },
        ]);
    });

    it('throws when the API key is absent', async () => {
        await expect(deepseekJson({ apiKey: '', system: 's', user: 'u', fetchImpl: () => {} }))
            .rejects.toThrow(/DEEPSEEK_API_KEY/);
    });

    it('throws on a non-OK response', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'slow down' }));
        await expect(deepseekJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl }))
            .rejects.toThrow(/DeepSeek HTTP 429/);
    });

    it('throws with context when the response body is not JSON', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }));
        await expect(deepseekJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl }))
            .rejects.toThrow(/DeepSeek returned non-JSON response/);
    });

    it('throws with context when the model content is not JSON', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
        }));
        await expect(deepseekJson({ apiKey: 'k', system: 's', user: 'u', fetchImpl }))
            .rejects.toThrow(/DeepSeek returned non-JSON content/);
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
    it('captures the exact pre-refactor request body for one language', async () => {
        const englishSrt = '1\n00:00:00,500 --> 00:00:03,000\nHello';
        const { fetchImpl, calls } = stubFetch({ srt: 'translated' });
        const out = await translateSrt(englishSrt, 'es', { fetchImpl, apiKey: 'k' });
        expect(out).toBe('translated');
        // The literal body the captions pipeline used to send (pre-049).
        const expected = {
            model: 'deepseek-v4-flash',
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
});
