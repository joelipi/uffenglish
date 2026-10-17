// functions/api/email-validate.js
// Cloudflare Pages Function — the authoritative zero-cost email screen behind
// signup. The browser wrapper in src/modules/auth/email-validation-logic.js only
// turns this verdict into one object the form can branch on: a client-side
// check is bypassed by posting straight to Supabase, so this is where the rules
// actually run.
//
// WHAT "EMAIL EXISTS" CAN AND CANNOT MEAN HERE
//
// Cloudflare Workers/Pages cannot open an outbound TCP connection on port 25
// ("By default, Workers cannot create outbound TCP connections on port 25"), so
// SMTP `RCPT TO` mailbox probing is impossible from functions/**. No API key
// changes that; it is a platform limit, not a pricing one. And SMTP would not
// settle it anyway — catch-all domains accept every local part and the large
// providers hide mailbox existence. The only reliable existence proof is double
// opt-in, which this repo already has (functions/api/welcome-email.js mails
// /confirm-email?token=... and migration 006 records the click).
//
// So this screen catches what is CERTAIN to bounce: a malformed address, a
// throwaway provider, a misspelled domain, or a domain with no mail route at
// all. It never claims to have proved an inbox exists.
//
// WHY IT COSTS NOTHING
//
// The single network call is Cloudflare's public DNS-over-HTTPS resolver, which
// is keyless, unmetered and bills nothing per query. There is no API key, no
// account, no third-party SDK and — deliberately — no environment variable at
// all. That last point matters operationally: `wrangler pages deploy` drops
// dashboard plain-text variables that are not listed in wrangler.toml [vars], so
// adding a variable here would be a deployment footgun. Adding none removes it.
//
// FAIL-OPEN CONTRACT (a third contract in this repo)
//
//   functions/api/turnstile-verify.js  fails CLOSED  — a bot gate must not admit bots.
//   functions/api/welcome-email.js     fails OPEN    — the mail is optional.
//   functions/api/email-validate.js    fails OPEN for every uncertainty.
//
// A signup must never be lost because Cloudflare's resolver had a bad minute, so
// ONLY deterministic verdicts block: empty, syntax, domain, too-long,
// disposable, typo, domain-not-found, null-mx and no-mail-route. Every
// uncertainty — SERVFAIL, a timeout, an unreadable body, a non-ASCII domain we
// decline to look up — resolves to { valid: true, reason: 'lookup-unavailable' }
// and logs console.warn so the volume is visible.
//
// Only the DOMAIN is ever sent to the resolver. The local part appears in no
// query string, no log line and no error message.
//
// Response shape is always 200 { valid, reason, suggestion } for a verdict;
// 400 { valid: false, reason: 'bad-request' } is reserved for a malformed
// request. There is no per-IP throttle: the domain cache reduces amplification
// for REPEATED domains only (a caller cycling unique domains still costs one or
// two subrequests each), and the endpoint reveals nothing beyond "can this
// domain receive mail", which the DNS already tells anyone.

import {
    normalizeEmail,
    validateEmailSyntax,
    extractDomain,
    isDisposableDomain,
    suggestDomain,
} from '../../src/modules/auth/email-validation-logic.js';

// Cloudflare's public resolver. Keyless and unmetered — the reason this whole
// screen is free.
export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
export const DOH_ACCEPT = 'application/dns-json';

// Outbound timeout so a slow resolver cannot hold the Function open.
export const DOH_TIMEOUT_MS = 5000;

// DNS RCODEs we act on. 0 = NOERROR, 3 = NXDOMAIN. Everything else (notably 2 =
// SERVFAIL) is an uncertainty, not a verdict.
const RCODE_NOERROR = 0;
const RCODE_NXDOMAIN = 3;

// RFC 7505 Null MX: preference 0, exchange "." — the domain explicitly states
// it accepts no mail. Live example: example.edu answers Status 0 with "0 .".
const NULL_MX_PATTERN = /^0\s+\.$/;

// A request body larger than this cannot be a single email address.
export const EMAIL_VALIDATE_BODY_MAX_BYTES = 1024;

// MX TTLs are commonly 300s; 10 minutes is a conservative staleness bound that
// still collapses a burst of signups from one domain into a single lookup.
export const EMAIL_VALIDATE_CACHE_TTL_MS = 600000;
export const EMAIL_VALIDATE_CACHE_MAX_ENTRIES = 500;

// Internal sentinel from classifyDnsResult: the MX query came back clean with no
// MX record, and the caller must still ask for A/AAAA before it may reject.
// It distinguishes "not looked up" from "looked up and empty", which is what
// keeps a deliverable MX-less domain from being rejected. Never sent to a client.
export const NEEDS_ADDRESS_LOOKUP = 'needs-address-lookup';

const DNS_TYPES = { MX: 'MX', A: 'A', AAAA: 'AAAA' };

/**
 * Isolate-local domain -> DNS verdict cache.
 *
 * Per-isolate and best-effort: Cloudflare runs many isolates, so this lowers
 * cost rather than guaranteeing one lookup per domain. Its real value is
 * reducing amplification for REPEATED domains — a caller cycling unique domains
 * still costs one (or two) outbound subrequests each, and concurrent first-hits
 * on one domain are not coalesced. Local stages (syntax, disposable, typo) run
 * before the cache and are free anyway.
 *
 * Only deterministic verdicts are cached. A 'lookup-unavailable' is an
 * infrastructure fault, and caching one would turn a momentary resolver problem
 * into a ten-minute "no opinion" window for that domain — it is fail-open
 * anyway, so re-querying costs nothing and is always safe.
 */
const dnsCache = new Map();

/** Resets the cache. Exported for tests; not part of the request contract. */
export function clearDnsCache() {
    dnsCache.clear();
}

function readCache(domain) {
    const hit = dnsCache.get(domain);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAt) {
        dnsCache.delete(domain);
        return null;
    }
    return hit.verdict;
}

function writeCache(domain, verdict) {
    // Never pin an infrastructure fault (see the cache note above).
    if (verdict.reason === 'lookup-unavailable') return;
    // FIFO by insertion order: re-inserting would refresh recency, so delete
    // first to keep the oldest key the oldest.
    if (dnsCache.has(domain)) dnsCache.delete(domain);
    dnsCache.set(domain, { verdict, expiresAt: Date.now() + EMAIL_VALIDATE_CACHE_TTL_MS });
    while (dnsCache.size > EMAIL_VALIDATE_CACHE_MAX_ENTRIES) {
        const oldest = dnsCache.keys().next().value;
        dnsCache.delete(oldest);
    }
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const validResponse = (reason = 'ok', suggestion = '') =>
    jsonResponse({ valid: true, reason, suggestion });

// A verdict is always 200. Only a malformed REQUEST is a 400 — the one case
// where the caller sent something unusable rather than an address we declined,
// so the status is an explicit argument and never an inferred default.
const invalidResponse = (reason, suggestion = '', status = 200) =>
    jsonResponse({ valid: false, reason, suggestion }, status);

const badRequestResponse = () => invalidResponse('bad-request', '', 400);

/**
 * Turn a DNS-over-HTTPS JSON answer into a verdict. Pure and exported so every
 * branch is unit-testable without a network.
 *
 * @param {object|null} dnsJson  the resolver's JSON body
 * @param {object} [options]
 * @param {string} [options.domain]             the domain that was queried
 * @param {string[]} [options.addressRecords]   A/AAAA answers, when already
 *        looked up. Omitted means "not looked up yet" (returns the
 *        NEEDS_ADDRESS_LOOKUP sentinel); an empty array means "looked up, no
 *        records", which is a definite no-mail-route.
 * @returns {{ok: boolean, reason: string}}
 */
export function classifyDnsResult(dnsJson, { domain, addressRecords } = {}) {
    // A body we cannot read is an uncertainty, never a rejection.
    if (!dnsJson || typeof dnsJson !== 'object' || typeof dnsJson.Status !== 'number') {
        console.warn(`[email-validate] unreadable DNS answer for ${domain} — allowing signup`);
        return { ok: true, reason: 'lookup-unavailable' };
    }

    const { Status } = dnsJson;

    if (Status === RCODE_NXDOMAIN) {
        console.log(`[email-validate] ${domain} does not exist`);
        return { ok: false, reason: 'domain-not-found' };
    }
    if (Status !== RCODE_NOERROR) {
        console.warn(`[email-validate] DNS rcode ${Status} for ${domain} — allowing signup`);
        return { ok: true, reason: 'lookup-unavailable' };
    }

    const answers = Array.isArray(dnsJson.Answer) ? dnsJson.Answer : [];
    const mxRecords = answers.filter((a) => a && Number(a.type) === 15);

    // RFC 7505 Null MX: NOERROR, but the domain declares it takes no mail.
    if (mxRecords.some((a) => typeof a.data === 'string' && NULL_MX_PATTERN.test(a.data.trim()))) {
        console.log(`[email-validate] ${domain} publishes a Null MX`);
        return { ok: false, reason: 'null-mx' };
    }

    if (mxRecords.length > 0) {
        return { ok: true, reason: 'ok' };
    }

    // No MX. RFC 5321 section 5.1: a domain with an A or AAAA record and no MX
    // uses that address as an implicit MX, so it can still receive mail.
    if (!Array.isArray(addressRecords)) {
        // Deliberately ok:false — the verdict is genuinely undecided, and
        // resolveDomain replaces it before anything reads .ok. A loud "not ok"
        // is safer than a false positive if a future caller forgets the
        // sentinel: tests catch the regression instead of signups silently
        // slipping through an unfinished check.
        return { ok: false, reason: NEEDS_ADDRESS_LOOKUP };
    }
    if (addressRecords.length > 0) {
        return { ok: true, reason: 'ok' };
    }
    console.log(`[email-validate] ${domain} has neither MX nor an address record`);
    return { ok: false, reason: 'no-mail-route' };
}

/**
 * Build the DoH URL for one query.
 *
 * Exported so the encoding can be unit-tested with a name that actually needs
 * it. `encodeURIComponent` is what stops a domain containing `&`, `#` or `?`
 * from appending or overriding query parameters — the resolver is a fixed
 * origin, so an unescaped name would let a caller steer the lookup.
 */
export function dohUrl(domain, type) {
    return `${DOH_ENDPOINT}?name=${encodeURIComponent(domain)}&type=${type}`;
}

/** One DoH query. Never throws — a transport fault becomes a null answer. */
async function queryDns(domain, type) {
    try {
        const res = await fetch(dohUrl(domain, type), {
            headers: { accept: DOH_ACCEPT },
            signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[email-validate] DoH ${type} returned ${res.status} for ${domain}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.warn(`[email-validate] DoH ${type} failed for ${domain}:`, e?.message || e);
        return null;
    }
}

/**
 * A DoH answer we can act on: NOERROR (the answer set is trustworthy) or
 * NXDOMAIN (definitively no such record). Any other rcode — SERVFAIL, REFUSED,
 * a truncation flag — is an uncertainty about the RESOLVER, not a statement
 * about the domain.
 */
function isDefinitiveDnsAnswer(json) {
    if (!json || typeof json !== 'object' || typeof json.Status !== 'number') return false;
    return json.Status === RCODE_NOERROR || json.Status === RCODE_NXDOMAIN;
}

/**
 * A/AAAA answers for the implicit-MX fallback, or null when we have no opinion.
 *
 * Returning [] means "looked up properly, there is no address record" and leads
 * to a `no-mail-route` rejection; returning null means "could not find out" and
 * leads to fail-open. The distinction matters: a SERVFAIL body is a truthy
 * object, so a naive `json.Answer ?? []` would read a resolver fault as "this
 * domain has no address" and reject — then cache — a deliverable address for
 * the full TTL. That is exactly the outcome the fail-open contract forbids.
 */
async function queryAddressRecords(domain) {
    for (const type of [DNS_TYPES.A, DNS_TYPES.AAAA]) {
        const json = await queryDns(domain, type);
        if (!isDefinitiveDnsAnswer(json)) {
            // Every uncertainty is logged so the volume of no-op lookups stays
            // visible in the Pages logs. Without this the fallback would return
            // "no opinion" silently, which is the opposite of the contract.
            const why = json && typeof json === 'object' && typeof json.Status === 'number'
                ? `rcode ${json.Status}`
                : 'unreadable answer';
            console.warn(`[email-validate] ${type} lookup unusable for ${domain} (${why}) — allowing signup`);
            return null;
        }
        const answers = Array.isArray(json.Answer) ? json.Answer : [];
        const records = answers
            .filter((a) => a && (Number(a.type) === 1 || Number(a.type) === 28))
            .map((a) => a.data)
            .filter((d) => typeof d === 'string' && d.length > 0);
        if (records.length > 0) return records;
    }
    return [];
}

/**
 * Resolve a domain to a definitive verdict, consulting the cache.
 */
async function resolveDomain(domain) {
    const cached = readCache(domain);
    if (cached) return cached;

    const mxJson = await queryDns(domain, DNS_TYPES.MX);
    let verdict = classifyDnsResult(mxJson, { domain });

    if (verdict.reason === NEEDS_ADDRESS_LOOKUP) {
        const addressRecords = await queryAddressRecords(domain);
        // An unanswerable fallback leaves us with no opinion, so fail open
        // rather than reject a domain we never finished checking.
        if (addressRecords === null) {
            verdict = { ok: true, reason: 'lookup-unavailable' };
        } else {
            verdict = classifyDnsResult(mxJson, { domain, addressRecords });
        }
    }

    writeCache(domain, verdict);
    return verdict;
}

export async function onRequestPost({ request, env }) {
    // env is deliberately unused: this screen adds no configuration. Signature
    // kept for the Pages Functions contract.
    void env;

    const raw = await request.text().catch(() => null);
    if (typeof raw !== 'string' || raw.length === 0) {
        return badRequestResponse();
    }
    if (new TextEncoder().encode(raw).length > EMAIL_VALIDATE_BODY_MAX_BYTES) {
        return badRequestResponse();
    }
    // Malformed JSON is a malformed request, not a crash out of the handler.
    let body = null;
    try {
        body = JSON.parse(raw);
    } catch (e) {
        console.warn('[email-validate] request body was not JSON — rejecting');
        return badRequestResponse();
    }
    if (!body || typeof body.email !== 'string') {
        return badRequestResponse();
    }

    const email = normalizeEmail(body.email);

    // Local, offline, deterministic — these cost nothing and need no resolver.
    const syntax = validateEmailSyntax(email);
    if (!syntax.valid) {
        console.log(`[email-validate] rejected at the syntax stage (${syntax.reason})`);
        return invalidResponse(syntax.reason);
    }

    const domain = extractDomain(email);
    if (isDisposableDomain(domain)) {
        console.log(`[email-validate] rejected a throwaway domain: ${domain}`);
        return invalidResponse('disposable');
    }

    const suggestion = suggestDomain(domain);
    if (suggestion) {
        console.log(`[email-validate] ${domain} looks like a misspelling of ${suggestion}`);
        return invalidResponse('typo', suggestion);
    }

    // A percent-encoded unicode name can come back NXDOMAIN even when the
    // punycode domain exists, so we decline to guess and fail open instead of
    // inventing a false rejection.
    if (/[^\x21-\x7e]/.test(domain)) {
        console.warn(`[email-validate] non-ASCII domain, not looked up — allowing signup`);
        return validResponse('lookup-unavailable');
    }

    const verdict = await resolveDomain(domain);
    if (!verdict.ok) return invalidResponse(verdict.reason);
    return validResponse(verdict.reason);
}
