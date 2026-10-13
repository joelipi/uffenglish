-- 008_add_push_subscriptions.sql
-- Web push (story 063): mirror an in-app notification to the recipient's
-- devices over Web Push.
--
-- Two objects:
--   1. public.push_subscriptions — one row per device push endpoint. The app
--      registers/unregisters its own rows under RLS; the sender Function reads
--      across users with the service-role key.
--   2. public.notify_push_on_notification() — an AFTER INSERT OR UPDATE trigger
--      on user_notifications that POSTs the row to the sender Function via
--      pg_net. It is deliberately inert until both Vault secrets exist, and it
--      can never break the notification write (every failure path returns NEW).
--
-- The webhook URL and its shared secret live in Supabase Vault (names
-- `push_webhook_url` / `push_webhook_secret`), NOT in a Postgres GUC: a custom
-- `app.*` setting is readable by any role that can run current_setting(), while
-- vault.decrypted_secrets is restricted to the owning role. The trigger function
-- is SECURITY DEFINER (owner = postgres) so it can read Vault; nobody else is
-- granted EXECUTE.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  -- Per user, not global: a shared device can host two signed-in users, and each
  -- must own its own row (a global unique endpoint would make the second user's
  -- insert collide with the first's row, which RLS forbids them to touch).
  constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint)
);

-- The sender's lookup: all subscriptions for one recipient.
create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Owner-only, like the rest of the per-user tables (001/005).
drop policy if exists "owner read" on public.push_subscriptions;
create policy "owner read"
  on public.push_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "owner insert" on public.push_subscriptions;
create policy "owner insert"
  on public.push_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "owner delete" on public.push_subscriptions;
create policy "owner delete"
  on public.push_subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on table public.push_subscriptions to authenticated;
-- No UPDATE grant: a re-subscribe deletes and re-inserts the owner's own row
-- (which also covers the browser rotating the encryption keys for the same
-- endpoint). That keeps the privileged surface to exactly "own your devices",
-- with no column-level update path to reason about.

-- Mirror one notification row to the push sender. Never raises: the
-- notification insert is the primary write and must not depend on push.
--
-- The decisions live INSIDE the function rather than in a trigger WHEN clause,
-- because `TG_OP` is only available in the function body — a WHEN expression may
-- reference NEW/OLD but not TG_OP ("column tg_op does not exist"). Keeping it here
-- also means one place to read the rule.
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Only a first notification or a genuinely new answer is worth a push:
  --   * marking a row read leaves created_at untouched      -> skip
  --   * a re-answer inside the cooldown window is the same  -> skip (rate limit)
  --     "I have a new answer" event, and is also what bounds a caller who loops
  --     the (unthrottled, authenticated) record_friend_response() RPC.
  -- A different friend is a different row, so it is an INSERT and always fires.
  if tg_op = 'UPDATE' then
    if new.created_at is not distinct from old.created_at then
      return new;
    end if;
    if new.created_at <= old.created_at + interval '5 minutes' then
      return new;
    end if;
  end if;

  -- Unconfigured (or Vault unavailable): silent no-op. This is what makes the
  -- migration safe to apply before the runbook steps are done.
  begin
    select s.decrypted_secret into v_url
    from vault.decrypted_secrets s where s.name = 'push_webhook_url' limit 1;
    select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'push_webhook_secret' limit 1;
  exception when others then
    return new;
  end;

  -- Both entries are required: a URL without the shared secret could only ever
  -- earn a 401 from the sender, so don't spend the round trip.
  if v_url is null or btrim(v_url) = ''
     or v_secret is null or btrim(v_secret) = '' then
    return new;
  end if;

  -- pg_net is required to make the outbound call. Skip (don't error) when the
  -- extension is absent so a project without it still accepts the migration.
  -- Named arguments: net.http_post is
  -- (url, body, params, headers, timeout_milliseconds) — positional order would
  -- put headers into `params`.
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'type', tg_op,
        'table', tg_table_name,
        'schema', tg_table_schema,
        'record', to_jsonb(new)
      ),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-push-webhook-secret', coalesce(v_secret, '')
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    return new;
  end;

  return new;
end;
$$;

revoke all on function public.notify_push_on_notification() from public, anon, authenticated;

drop trigger if exists trg_user_notifications_push on public.user_notifications;

-- No WHEN clause: the get-out conditions need TG_OP, which a WHEN expression
-- cannot see (see the function above). The cost is one cheap function call on
-- every notification write, including a mark-as-read.
drop trigger if exists trg_user_notifications_push on public.user_notifications;
create trigger trg_user_notifications_push
  after insert or update on public.user_notifications
  for each row
  execute function public.notify_push_on_notification();
