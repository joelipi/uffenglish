-- 006_add_email_confirmation.sql
-- Non-blocking "click to confirm" email verification.
--
-- Supabase's own email confirmation is all-or-nothing: turning it on
-- (auth.email.enable_confirmations) withholds the session from signUp() until
-- the user clicks, which would BLOCK signup. This app must keep signup
-- non-blocking, so confirmation lives at the application layer instead:
--
--   * user_profiles.email_confirmed / email_confirmed_at record the result.
--   * email_confirm_tokens holds a SHA-256 hash of a single-use, random token
--     that the welcome email links to. The raw token is never stored.
--
-- The server (functions/api/welcome-email.js) inserts the hash with the
-- service-role key, and the confirm page invokes confirm_email_hash()
-- anonymously — the token is the only credential. The table itself grants
-- nobody SELECT (the hash must never be readable), and no INSERT either: if an
-- authenticated user could write their own token row they could self-confirm
-- without ever receiving the email, which would defeat the whole signal.

-- ---------------------------------------------------------------------------
-- user_profiles: the verification flag. anon's column-level GRANT (003) does
-- NOT include these, so they are never exposed to anonymous callers; an
-- authenticated owner reads them via their full-row grant.
-- ---------------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists email_confirmed boolean not null default false,
  add column if not exists email_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- email_confirm_tokens: one row per outstanding confirmation link.
-- token_hash is the SHA-256 hex of the 32-byte random token in the URL.
-- ---------------------------------------------------------------------------
create table if not exists public.email_confirm_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_confirm_tokens_user
  on public.email_confirm_tokens (user_id);

alter table public.email_confirm_tokens enable row level security;

-- Deliberately NO policies and NO grants to anon/authenticated: they can neither
-- read the hashes nor mint a token. Only the service role (which bypasses RLS)
-- and the SECURITY DEFINER functions below touch this table. This project has
-- "automatically expose new tables = OFF", so the service role's privileges
-- must be granted explicitly (same reason as 002).
revoke all on table public.email_confirm_tokens from anon, authenticated;
grant all on table public.email_confirm_tokens to service_role;

-- ---------------------------------------------------------------------------
-- confirm_email_hash: the confirm page hashes the raw token client-side
-- (WebCrypto SHA-256) and passes the hex here. SECURITY DEFINER so the function
-- can read the token row and write user_profiles on behalf of a caller who is
-- not signed in (the email may be opened on another device).
--
-- Safe to expose to anon: it only ever matches an unguessable 64-hex hash and
-- deletes the token on success (single use). It never reveals whose hash it is.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_email_hash(p_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  -- Reject anything that is not a SHA-256 hex digest before touching the table.
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select user_id into v_user
  from public.email_confirm_tokens
  where token_hash = p_hash
    and expires_at > now()
  limit 1;

  if v_user is null then
    return false;
  end if;

  update public.user_profiles
    set email_confirmed = true,
        email_confirmed_at = now()
    where id = v_user;

  -- Single use: burn every outstanding token for this user once confirmed.
  delete from public.email_confirm_tokens where user_id = v_user;

  return true;
end;
$$;

revoke all on function public.confirm_email_hash(text) from public;
grant execute on function public.confirm_email_hash(text) to anon, authenticated;
