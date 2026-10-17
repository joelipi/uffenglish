// @vitest-environment node
// The authoritative zero-cost email screen: every classifyDnsResult branch, the
// deterministic local rejections, the implicit-MX fallback, and the fail-open
// contract that keeps a resolver fault from ever blocking a signup.
//
// No network: globalThis.fetch is stubbed and routed by the `type=` query
// parameter, so a DoH "answer" here is a fixture, not a lookup.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    onRequestPost,
    classifyDnsResult,
    clearDnsCache,
    DOH_ENDPOINT,
    DOH_ACCEPT,
    DOH_TIMEOUT_MS,
    NEEDS_ADDRESS_LOOKUP,
    EMAIL_VALIDATE_BODY_MAX_BYTES,
    EMAIL_VALIDATE_CACHE_TTL_MS,
    EMAIL_VALIDATE_CACHE_MAX_ENTRIES,
} from './email-validate.js';

// ---------------------------------------------------------------- DoH fixtures
// Shapes captured from live Cloudflare DoH responses.
const MX_OK = { Status: 0, Answer: [{ type: 15, TTL: 300, data: '10 mail.example.com.' }] };
const MX_MULTI = {
    Status: 0,
    Answer: [
        { type: 15, TTL: 54, data: '5 gmail-smtp-in.l.google.com.' },
        { type: 15, TTL: 54, data: '20 alt2.gmail-smtp-in.l.google.com.' },
    ],
};
// example.edu's live answer: Status 0 carrying an RFC 7505 Null MX.
const MX_NULL = { Status: 0, Answer: [{ type: 15, TTL: 3600, data: '0 .' }] };
const MX_NONE = { Status: 0, Answer: [] };
const NXDOMAIN = { Status: 3, Answer: [] };
const SERVFAIL = { Status: 2, Answer: [] };
const A_OK = { Status: 0, Answer: [{ type: 1, TTL: 249, data: '203.0.113.5' }] };
const AAAA_OK = { Status: 0, Answer: [{ type: 28, TTL: 249, data: '2001:db8::1' }] };

// A request double. onRequestPost reads the body via text() so it can enforce a
// byte cap before parsing.
function makeRequest(body) {
    return {
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

const post = (email) => onRequestPost({ request: makeRequest({ email }), env: {} });

/** Route DoH calls by `type=` and record every URL that was requested. */
function installDns({ mx = MX_OK, a = A_OK, aaaa = AAAA_OK, fail = false } = {}) {
    const calls = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        calls.push(String(url));
        if (fail) throw new Error('DoH unreachable');
        const type = /type=([A-Z]+)/.exec(String(url))?.[1];
        const body = type === 'MX' ? mx : type === 'A' ? a : aaaa;
        return { ok: true, status: 200, json: async () => body };
    });
    return { spy, calls };
}

const typesOf = (calls) => calls.map((u) => /type=([A-Z]+)/.exec(u)?.[1]);

let logSpy;
let warnSpy;
let errorSpy;

beforeEach(() => {
    clearDnsCache();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearDnsCache();
});

// ------------------------------------------------------- classifyDnsResult (pure)
describe('classifyDnsResult', () => {
    it('rejects a domain that does not exist (NXDOMAIN)', () => {
        expect(classifyDnsResult(NXDOMAIN, { domain: 'gone.test' }))
            .toEqual({ ok: false, reason: 'domain-not-found' });
    });

    it('allows an unknown rcode — an uncertainty is never a rejection', () => {
        expect(classifyDnsResult(SERVFAIL, { domain: 'flaky.test' }))
            .toEqual({ ok: true, reason: 'lookup-unavailable' });
        for (const Status of [1, 4, 5, 9]) {
            expect(classifyDnsResult({ Status }, { domain: 'x.test' }).reason)
                .toBe('lookup-unavailable');
        }
    });

    it('allows an unreadable answer', () => {
        for (const body of [null, undefined, 'nope', 42, {}, { Status: '0' }]) {
            expect(classifyDnsResult(body, { domain: 'x.test' }))
                .toEqual({ ok: true, reason: 'lookup-unavailable' });
        }
    });

    it('rejects a Null MX (RFC 7505 "0 .") even though the rcode is NOERROR', () => {
        expect(classifyDnsResult(MX_NULL, { domain: 'example.edu' }))
            .toEqual({ ok: false, reason: 'null-mx' });
    });

    it('accepts one or many real MX records', () => {
        expect(classifyDnsResult(MX_OK, { domain: 'example.com' })).toEqual({ ok: true, reason: 'ok' });
        expect(classifyDnsResult(MX_MULTI, { domain: 'gmail.com' })).toEqual({ ok: true, reason: 'ok' });
    });

    it('accepts an MX-less domain that has an address record (implicit MX, RFC 5321 §5.1)', () => {
        expect(classifyDnsResult(MX_NONE, { domain: 'web.test', addressRecords: ['203.0.113.5'] }))
            .toEqual({ ok: true, reason: 'ok' });
    });

    it('rejects an MX-less domain that was looked up and has no address record', () => {
        expect(classifyDnsResult(MX_NONE, { domain: 'web.test', addressRecords: [] }))
            .toEqual({ ok: false, reason: 'no-mail-route' });
    });

    it('asks for the address lookup when the caller has not performed it yet', () => {
        // The three-state distinction: "not looked up" is neither ok nor a
        // rejection, so an MX-less domain cannot be rejected unexamined.
        expect(classifyDnsResult(MX_NONE, { domain: 'web.test' }))
            .toEqual({ ok: false, reason: NEEDS_ADDRESS_LOOKUP });
        expect(classifyDnsResult(MX_NONE)).toEqual({ ok: false, reason: NEEDS_ADDRESS_LOOKUP });
    });

    it('ignores non-MX answers when counting MX records', () => {
        const mixed = { Status: 0, Answer: [{ type: 1, data: '203.0.113.5' }] };
        expect(classifyDnsResult(mixed, { domain: 'web.test', addressRecords: [] }))
            .toEqual({ ok: false, reason: 'no-mail-route' });
    });
});

// ------------------------------------------------------------ bad request (400)
describe('onRequestPost bad request', () => {
    it('rejects a missing, empty, non-string or oversized body without looking anything up', async () => {
        const { calls } = installDns();
        const bad = [
            makeRequest(''),
            makeRequest('   '),
            makeRequest({}),
            makeRequest({ email: 42 }),
            makeRequest({ email: null }),
            makeRequest({ email: ['a@b.test'] }),
            makeRequest(`{"email":"a@b.test","pad":"${'x'.repeat(EMAIL_VALIDATE_BODY_MAX_BYTES)}"}`),
        ];
        for (const request of bad) {
            const res = await onRequestPost({ request, env: {} });
            expect(res.status, `expected 400 for ${JSON.stringify(request)}`).toBe(400);
            // Same response shape as every other verdict, only the status differs.
            expect(await res.json()).toEqual({ valid: false, reason: 'bad-request', suggestion: '' });
        }
        expect(calls).toHaveLength(0);
    });

    it('rejects a body that is not JSON at all, without throwing', async () => {
        const { calls } = installDns();
        const res = await onRequestPost({ request: makeRequest('{not json'), env: {} });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ valid: false, reason: 'bad-request', suggestion: '' });
        expect(calls).toHaveLength(0);
    });
});

// ------------------------------------------------ deterministic local rejections
describe('onRequestPost local rejections cost nothing', () => {
    const cases = [
        ['', 'empty'],
        ['   ', 'empty'],
        ['jo', 'syntax'],
        ['jo@@example.com', 'syntax'],
        ['jo k@example.com', 'syntax'],
        ['@example.com', 'syntax'],
        ['jo@example', 'domain'],
        ['jo@.example.com', 'domain'],
        ['jo@example..com', 'domain'],
        ['jo@example.com.', 'domain'],
        ['jo@example.c0m', 'domain'],
        // '@example.com' is 12 characters, so 243 a's puts the address at 255.
        [`${'a'.repeat(243)}@example.com`, 'too-long'],
        ['jo@mailinator.com', 'disposable'],
        ['jo@guerrillamail.com', 'disposable'],
    ];

    it.each(cases)('rejects %j as %s with 200 and zero lookups', async (email, reason) => {
        const { calls } = installDns();
        const res = await post(email);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ valid: false, reason, suggestion: '' });
        expect(calls).toHaveLength(0);
    });

    it('rejects a misspelled domain with the corrected suggestion', async () => {
        const { calls } = installDns();
        const res = await post('jo@gmial.com');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ valid: false, reason: 'typo', suggestion: 'gmail.com' });
        expect(calls).toHaveLength(0);
    });

    it('accepts the address the whole existing suite signs up with', async () => {
        installDns({ mx: MX_NONE, a: A_OK });
        const res = await post('jo@example.com');
        expect(await res.json()).toEqual({ valid: true, reason: 'ok', suggestion: '' });
    });
});

// ------------------------------------------------------------- DNS verdicts (200)
describe('onRequestPost DNS verdicts', () => {
    it('rejects a domain that does not exist', async () => {
        installDns({ mx: NXDOMAIN });
        expect(await (await post('jo@gone.test')).json())
            .toEqual({ valid: false, reason: 'domain-not-found', suggestion: '' });
    });

    it('rejects a Null MX domain', async () => {
        installDns({ mx: MX_NULL });
        expect(await (await post('jo@example.edu')).json())
            .toEqual({ valid: false, reason: 'null-mx', suggestion: '' });
    });

    it('rejects a domain with neither MX nor an address record', async () => {
        installDns({ mx: MX_NONE, a: { Status: 0, Answer: [] }, aaaa: { Status: 0, Answer: [] } });
        expect(await (await post('jo@nowhere.test')).json())
            .toEqual({ valid: false, reason: 'no-mail-route', suggestion: '' });
    });

    it('accepts a domain with MX records', async () => {
        installDns({ mx: MX_MULTI });
        expect(await (await post('jo@gmail.com')).json())
            .toEqual({ valid: true, reason: 'ok', suggestion: '' });
    });

    describe('fails open so a resolver fault never blocks a signup', () => {
        it('on SERVFAIL', async () => {
            installDns({ mx: SERVFAIL });
            expect(await (await post('jo@flaky.test')).json())
                .toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
            expect(warnSpy).toHaveBeenCalled();
        });

        it('when the transport throws (timeout or DNS outage)', async () => {
            installDns({ fail: true });
            expect(await (await post('jo@flaky.test')).json())
                .toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
            expect(warnSpy).toHaveBeenCalled();
        });

        it('when the answer body is unreadable', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => null,
            });
            expect(await (await post('jo@flaky.test')).json())
                .toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
        });

        it('when the resolver answers an HTTP error', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
            expect(await (await post('jo@flaky.test')).json())
                .toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
        });

        it('on the A/AAAA fallback, so an unexamined MX-less domain is allowed', async () => {
            // The MX query is clean but the implicit-MX fallback cannot be
            // completed — we have no opinion, so we must not reject.
            vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
                const type = /type=([A-Z]+)/.exec(String(url))?.[1];
                if (type === 'MX') return { ok: true, status: 200, json: async () => MX_NONE };
                throw new Error('DoH unreachable');
            });
            expect(await (await post('jo@web.test')).json())
                .toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
            expect(warnSpy).toHaveBeenCalled();
        });
    });
});

// ------------------------------------------------------------------ DoH request
describe('onRequestPost DoH request', () => {
    it('queries the free Cloudflare resolver for the MX record with a timeout', async () => {
        const { calls } = installDns();
        await post('jo@example.com');

        expect(calls[0]).toBe(`${DOH_ENDPOINT}?name=example.com&type=MX`);
        const [, init] = globalThis.fetch.mock.calls[0];
        expect(init.headers.accept).toBe(DOH_ACCEPT);
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(DOH_ENDPOINT).toBe('https://cloudflare-dns.com/dns-query');
        expect(DOH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('never sends the local part in the query or in any log line', async () => {
        const { calls } = installDns({ mx: NXDOMAIN });
        await post('quintinlocalpart@private-domain.test');

        for (const url of calls) expect(url).not.toContain('quintinlocalpart');
        const logged = [logSpy, warnSpy, errorSpy]
            .flatMap((s) => s.mock.calls.flat().map((a) => String(a?.message ?? a)));
        for (const line of logged) expect(line).not.toContain('quintinlocalpart');
    });

    it('percent-encodes the domain it queries', async () => {
        // A wildcard DNS name is syntactically a domain but must not break the
        // query string.
        const { calls } = installDns();
        await post('jo@sub.example.com');
        expect(calls[0]).toContain('name=sub.example.com');
    });

    describe('non-ASCII domains are not looked up', () => {
        it('fail open with zero queries rather than risk a false rejection', async () => {
            const { calls } = installDns();
            // A percent-encoded unicode name can return NXDOMAIN even when the
            // punycode form exists, so guessing would invent a rejection.
            const res = await post('jo@münchen.de');
            expect(await res.json()).toEqual({ valid: true, reason: 'lookup-unavailable', suggestion: '' });
            expect(calls).toHaveLength(0);
            expect(warnSpy).toHaveBeenCalled();
        });
    });
});

// ------------------------------------------------------- implicit MX fallback
describe('onRequestPost implicit MX fallback (RFC 5321 §5.1)', () => {
    it('asks A, then AAAA, and accepts the domain when A answers', async () => {
        const { calls } = installDns({ mx: MX_NONE, a: A_OK });
        const res = await post('jo@web.test');
        expect(await res.json()).toEqual({ valid: true, reason: 'ok', suggestion: '' });
        expect(typesOf(calls)).toEqual(['MX', 'A']);
    });

    it('falls through to AAAA when A is empty and accepts on that', async () => {
        const { calls } = installDns({ mx: MX_NONE, a: { Status: 0, Answer: [] }, aaaa: AAAA_OK });
        const res = await post('jo@web6.test');
        expect(await res.json()).toEqual({ valid: true, reason: 'ok', suggestion: '' });
        expect(typesOf(calls)).toEqual(['MX', 'A', 'AAAA']);
    });

    it('rejects only once both the MX and the address lookups came back empty', async () => {
        const { calls } = installDns({
            mx: MX_NONE,
            a: { Status: 0, Answer: [] },
            aaaa: { Status: 0, Answer: [] },
        });
        expect(await (await post('jo@nowhere.test')).json())
            .toEqual({ valid: false, reason: 'no-mail-route', suggestion: '' });
        expect(typesOf(calls)).toEqual(['MX', 'A', 'AAAA']);
    });

    it('does not consult the address records when an MX was found', async () => {
        const { calls } = installDns({ mx: MX_OK });
        await post('jo@example.com');
        expect(typesOf(calls)).toEqual(['MX']);
    });

    it('does not consult the address records for a Null MX', async () => {
        const { calls } = installDns({ mx: MX_NULL });
        await post('jo@example.edu');
        expect(typesOf(calls)).toEqual(['MX']);
    });
});

// ------------------------------------------------------------------ domain cache
describe('onRequestPost domain cache', () => {
    it('collapses two addresses on one domain into a single lookup', async () => {
        const { calls } = installDns();
        await post('jo@gmail.com');
        await post('kim@gmail.com');
        expect(calls).toHaveLength(1);
    });

    it('does not share a cache entry between different domains', async () => {
        const { calls } = installDns();
        await post('jo@gmail.com');
        await post('kim@outlook.com');
        expect(calls).toHaveLength(2);
    });

    it('caches rejections too, so a spam run costs one lookup', async () => {
        const { calls } = installDns({ mx: NXDOMAIN });
        await post('a@gone.test');
        await post('b@gone.test');
        expect(calls).toHaveLength(1);
    });

    it('never caches an infrastructure fault', async () => {
        // Caching "no opinion" would pin a domain for the whole TTL after one
        // bad minute from the resolver.
        const { calls } = installDns({ mx: SERVFAIL });
        await post('jo@flaky.test');
        await post('kim@flaky.test');
        expect(calls).toHaveLength(2);
    });

    it('refetches once the TTL has elapsed', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const { calls } = installDns();

        await post('jo@example.com');
        expect(calls).toHaveLength(1);

        vi.spyOn(Date, 'now').mockReturnValue(now + EMAIL_VALIDATE_CACHE_TTL_MS - 1000);
        await post('jo@example.com');
        expect(calls).toHaveLength(1);

        vi.spyOn(Date, 'now').mockReturnValue(now + EMAIL_VALIDATE_CACHE_TTL_MS + 1);
        await post('jo@example.com');
        expect(calls).toHaveLength(2);
    });

    it('evicts the oldest entry to stay bounded', async () => {
        expect(EMAIL_VALIDATE_CACHE_MAX_ENTRIES).toBe(500);
        expect(EMAIL_VALIDATE_CACHE_TTL_MS).toBe(600000);

        const { calls } = installDns({ mx: NXDOMAIN });
        // One more domain than the cap, oldest inserted first.
        for (let i = 0; i <= EMAIL_VALIDATE_CACHE_MAX_ENTRIES; i++) {
            await post(`user@d${i}.test`);
        }
        expect(calls).toHaveLength(EMAIL_VALIDATE_CACHE_MAX_ENTRIES + 1);

        const before = calls.length;
        await post('user@d0.test');            // oldest — must have been evicted
        expect(calls.length).toBe(before + 1);
        await post(`user@d${EMAIL_VALIDATE_CACHE_MAX_ENTRIES}.test`); // newest — still cached
        expect(calls.length).toBe(before + 1);
    });
});

// --------------------------------------------------------------- no configuration
describe('the screen adds no configuration', () => {
    const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    const source = read('./email-validate.js');

    it('reads no env property, so nothing has to be configured or redeployed', () => {
        // Anchored on the property access, not the bare word: the signature
        // destructures `env` and the header discusses environment variables,
        // both of which are legitimate and must not trip this.
        const envAccess = /env\s*\.\s*[A-Za-z_$]/;
        expect(envAccess.test("const x = env.SOME_KEY;")).toBe(true); // regex is not vacuous
        expect(envAccess.test(source)).toBe(false);
    });

    it('adds no key to wrangler.toml [vars] (a deploy would silently drop a dashboard-only var)', () => {
        const toml = read('../../wrangler.toml');
        const varsSection = toml.slice(toml.indexOf('[vars]'));
        expect(varsSection).toMatch(/EMAIL_FROM/); // pre-existing, proves the slice works
        expect(varsSection).not.toMatch(/EMAIL_VALIDATE|DOH_|email-validate/i);
    });
});

// ------------------------------------------------------------------- docs guard
describe('docs/email-validation.md', () => {
    it('documents the zero-cost rationale, the port-25 limit and the fail-open contract', () => {
        const docUrl = new URL('../../docs/email-validation.md', import.meta.url);
        const doc = readFileSync(fileURLToPath(docUrl), 'utf8');

        // Each anchor is asserted separately so deleting any one of them fails.
        expect(doc).toMatch(/port 25/i);
        expect(doc).toMatch(/cloudflare-dns\.com\/dns-query/);
        expect(doc).toMatch(/double opt-?in/i);
        expect(doc).toMatch(/fail[- ]open/i);
        expect(doc).toMatch(/wrangler\.toml/);

        // The confirmation flow is linked as a relative path from docs/, so
        // resolve it rather than string-matching a `docs/` prefix — and prove
        // the target still exists, which a bare toContain could never do.
        const link = /\]\((\.\/email-confirmation\.md)\)/.exec(doc);
        expect(link, 'no link to email-confirmation.md in the doc').toBeTruthy();
        expect(existsSync(fileURLToPath(new URL(link[1], docUrl)))).toBe(true);

        for (const reason of ['empty', 'syntax', 'domain', 'too-long', 'disposable', 'typo',
            'domain-not-found', 'null-mx', 'no-mail-route', 'lookup-unavailable']) {
            expect(doc, `reason code ${reason} is undocumented`).toContain(reason);
        }

        expect(doc).toMatch(/EMAIL_VALIDATE_CACHE_TTL_MS|600000|600 ?000/);
        expect(doc).toMatch(/example\.com|example\.org|example\.net/);
    });
});