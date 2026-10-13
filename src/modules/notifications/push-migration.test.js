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
const sql = readFileSync(
    path.join(__dirname, '../../../supabase/migrations/008_add_push_subscriptions.sql'),
    'utf8'
);

describe('008_add_push_subscriptions.sql — table', () => {
    it('creates push_subscriptions with the device endpoint and keys', () => {
        expect(sql).toContain('create table if not exists public.push_subscriptions');
        for (const column of ['user_id uuid not null references auth.users(id) on delete cascade',
            'endpoint text not null', 'p256dh text not null', 'auth text not null',
            'user_agent text not null default \'\'']) {
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

    it('skips updates that only mark a notification read', () => {
        // Without the WHEN guard, marking a row read would push an old
        // notification: created_at is refreshed only by a re-answer.
        expect(sql).toContain("when (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)");
    });

    it('reads its endpoint and secret from Vault, not a client-readable GUC', () => {
        expect(sql).toContain('from vault.decrypted_secrets');
        expect(sql).toContain("s.name = 'push_webhook_url'");
        expect(sql).toContain("s.name = 'push_webhook_secret'");
        expect(sql).not.toContain("current_setting('app.");
    });

    it('is inert until configured and when pg_net is absent', () => {
        expect(sql).toContain("if v_url is null or btrim(v_url) = '' then");
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
