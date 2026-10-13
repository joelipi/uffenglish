// modules/notifications/push-migration.test.js
// Static guard for the push migration. Supabase SQL cannot run in vitest, so the
// safety-critical properties are pinned by source: the table's least-privilege
// grants, and the trigger that must (a) skip the mark-as-read update, (b) never
// raise on the notification path, and (c) stay inert until it is configured.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../..');
const sql = readFileSync(
    path.join(repoRoot, 'supabase/migrations/008_add_push_subscriptions.sql'),
    'utf8'
);

describe('008_add_push_subscriptions.sql — table', () => {
    it('creates push_subscriptions with the device endpoint and keys', () => {
        expect(sql).toContain('create table if not exists public.push_subscriptions');
        for (const column of ['user_id uuid not null references auth.users(id) on delete cascade',
            'endpoint text not null', 'p256dh text not null', 'auth text not null',
            'user_agent text not null default \'\'',
            'created_at timestamptz not null default now()']) {
            expect(sql, column).toContain(column);
        }
    });

    it('keys a device per user, not globally', () => {
        expect(sql).toContain('constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint)');
        expect(sql).toContain('create index if not exists idx_push_subscriptions_user');
    });

    it('enables RLS and scopes every policy to the owner', () => {
        expect(sql).toContain('alter table public.push_subscriptions enable row level security');
        for (const policy of ['for select', 'for insert', 'for delete']) {
            expect(sql, policy).toContain(policy);
        }
        // Three owner-scoped policies, each on auth.uid() = user_id.
        expect(sql.match(/auth\.uid\(\) = user_id/g).length).toBeGreaterThanOrEqual(3);
    });

    it('grants the app only select/insert/delete — never update — and nothing to anon', () => {
        expect(sql).toContain('grant select, insert, delete on table public.push_subscriptions to authenticated');
        expect(sql).not.toMatch(/grant[^;]*\bupdate\b[^;]*on table public\.push_subscriptions/i);
        expect(sql).not.toMatch(/grant[^;]*to anon/i);
    });
});

describe('008_add_push_subscriptions.sql — webhook trigger', () => {
    it('fires on insert and on the re-answer update', () => {
        expect(sql).toContain('after insert or update on public.user_notifications');
        expect(sql).toContain('execute function public.notify_push_on_notification()');
    });

    it('gates on created_at alone, which subsumes the mark-as-read case', () => {
        // Marking a row read leaves created_at untouched, so the comparison
        // below is false and no push fires for an old notification.
        expect(sql).toContain("if v_url is null or btrim(v_url) = ''");
        expect(sql).toContain("tg_op = 'INSERT'");
        expect(sql).toContain("new.created_at > old.created_at + interval '5 minutes'");
        // The old, weaker predicate must be gone.
        expect(sql).not.toContain('is distinct from old.created_at');
    });

    describe('the cooldown predicate (executable spec of the WHEN clause)', () => {
        // The trigger cannot run in vitest (no Postgres), so this mirrors the SQL
        // predicate over a truth table. The interval is READ FROM THE MIGRATION,
        // so the expectations are pinned to the file rather than to a number
        // copied here, and the clause assertion above proves the predicate is
        // actually present.
        const match = sql.match(/interval '(\d+) minutes'/);
        const cooldownMinutes = match ? Number(match[1]) : NaN;

        /** `when (tg_op = 'INSERT' or new.created_at > old.created_at + interval …)` */
        function pushFires({ op, createdAt, previousCreatedAt }) {
            if (op === 'INSERT') return true;
            const window = cooldownMinutes * 60 * 1000;
            // Strictly greater, exactly as the SQL compares.
            return new Date(createdAt).getTime() - new Date(previousCreatedAt).getTime() > window;
        }

        const base = new Date('2026-10-13T12:00:00Z').getTime();
        const at = (minutes) => new Date(base + minutes * 60 * 1000).toISOString();

        it('reads a sane cooldown out of the migration', () => {
            expect(Number.isFinite(cooldownMinutes)).toBe(true);
            expect(cooldownMinutes).toBeGreaterThan(0);
        });

        it('fires for the first notification of a row', () => {
            expect(pushFires({ op: 'INSERT', createdAt: at(0) })).toBe(true);
        });

        it('SUPPRESSES a rapid re-answer (the abuse loop)', () => {
            expect(pushFires({ op: 'UPDATE', createdAt: at(1), previousCreatedAt: at(0) })).toBe(false);
            expect(pushFires({ op: 'UPDATE', createdAt: at(4), previousCreatedAt: at(0) })).toBe(false);
        });

        it('still fires for a re-answer after the window', () => {
            expect(pushFires({ op: 'UPDATE', createdAt: at(6), previousCreatedAt: at(0) })).toBe(true);
            expect(pushFires({ op: 'UPDATE', createdAt: at(600), previousCreatedAt: at(0) })).toBe(true);
        });

        it('never fires for mark-as-read (created_at unchanged)', () => {
            expect(pushFires({ op: 'UPDATE', createdAt: at(30), previousCreatedAt: at(30) })).toBe(false);
            expect(pushFires({ op: 'UPDATE', createdAt: at(999), previousCreatedAt: at(999) })).toBe(false);
        });
    });

    it('documents why the cooldown is per row, not per recipient', () => {
        // A different friend is a different (recipient, actor, type) => INSERT,
        // so the cooldown never delays a *new* person's answer.
        expect(sql).toContain('a *different* friend answering is a');
        expect(sql).toContain('Tune the interval here.');
    });

    it('reads its endpoint and secret from Vault, not a client-readable GUC', () => {
        expect(sql).toContain('from vault.decrypted_secrets');
        expect(sql).toContain("s.name = 'push_webhook_url'");
        expect(sql).toContain("s.name = 'push_webhook_secret'");
        expect(sql).not.toContain("current_setting('app.");
    });

    it('is inert until configured and when pg_net is absent', () => {
        expect(sql).toContain("if v_url is null or btrim(v_url) = ''");
        // A URL without the shared secret could only earn a 401 — skip instead
        // of spending the round trip.
        expect(sql).toContain("or v_secret is null or btrim(v_secret) = '' then");
        expect(sql).toContain("to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null");
    });

    it('calls net.http_post with named arguments so headers cannot land in params', () => {
        // Signature is (url, body, params, headers, timeout_milliseconds).
        expect(sql).toContain('url := v_url');
        expect(sql).toContain('body := jsonb_build_object(');
        expect(sql).toContain('headers := jsonb_build_object(');
        expect(sql).toContain('timeout_milliseconds := 5000');
        expect(sql).not.toMatch(/perform net\.http_post\(\s*v_url\s*,/);
    });

    it('can never break the notification write', () => {
        // Two guarded blocks (Vault read + the send) and a final `return new`.
        expect(sql.match(/exception when others then/g).length).toBeGreaterThanOrEqual(2);
        expect(sql).toContain('return new;');
        expect(sql).toContain('security definer');
        expect(sql).toContain('revoke all on function public.notify_push_on_notification() from public, anon, authenticated');
    });
});

describe('push provisioning wiring', () => {
    const wrangler = readFileSync(path.join(repoRoot, 'wrangler.toml'), 'utf8');
    const config = readFileSync(path.join(repoRoot, 'src/modules/notifications/push-config.js'), 'utf8');
    const runbook = readFileSync(path.join(repoRoot, 'docs/push-notifications.md'), 'utf8');

    it('lists the non-secret VAPID values in [vars] (secrets stay in the dashboard)', () => {
        // AGENTS.md: a non-secret Pages variable a Function reads must be in
        // wrangler.toml [vars], not only in the dashboard.
        expect(wrangler).toContain('[vars]');
        expect(wrangler).toContain('VAPID_PUBLIC_KEY =');
        expect(wrangler).toContain('VAPID_SUBJECT =');
        // The private key must never appear in the committed config.
        expect(wrangler).not.toMatch(/VAPID_PRIVATE_KEY\s*=/);
        expect(wrangler).not.toMatch(/PUSH_WEBHOOK_SECRET\s*=/);
    });

    it('keeps the [vars] public key and the committed default in sync', () => {
        const fromWrangler = (wrangler.match(/VAPID_PUBLIC_KEY\s*=\s*"([^"]+)"/) || [])[1];
        const fromConfig = (config.match(/DEFAULT_VAPID_PUBLIC_KEY\s*=\s*\n?\s*'([^']+)'/) || [])[1];
        expect(fromWrangler).toBeTruthy();
        expect(fromConfig).toBe(fromWrangler);
    });

    it('documents the runbook steps in docs/push-notifications.md', () => {
        for (const step of [
            'generate-vapid-keys',
            'VAPID_PRIVATE_KEY',
            'PUSH_WEBHOOK_SECRET',
            'SUPABASE_SERVICE_ROLE_KEY',
            'create extension if not exists pg_net',
            'push_webhook_url',
            'push_webhook_secret',
            'net._http_response',
        ]) {
            expect(runbook, step).toContain(step);
        }
    });
});
