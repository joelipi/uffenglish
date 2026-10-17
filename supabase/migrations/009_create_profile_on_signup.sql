-- 009_create_profile_on_signup.sql
--
-- WHY THIS EXISTS
--
-- Signing up could leave an `auth.users` account with NO `user_profiles` row at
-- all. Anything that later wrote to `user_profiles` for that account used an
-- upsert with `onConflict: 'id'`, and PostgREST resolves that to a plain INSERT
-- when no row exists — so the first write fabricated a row containing only the
-- columns it happened to supply. The result was a "ghost" profile: `email`,
-- `first_name`, `last_name`, `join_date` and `share_code` all NULL, with just
-- `course_progress` (or the geo columns) populated. Such an account renders
-- like an anonymous visitor, has no share code, and silently fails to persist
-- lesson progress.
--
-- The row is created here instead, inside the same transaction that creates the
-- auth user, so "account without profile" stops being reachable at all.
--
-- The client is still the source of truth for the fields only it knows:
-- `useSignupForm` writes `english_level`, `share_code` and the guest-lesson
-- credit with an `upsert(..., { onConflict: 'id' })`, which now UPDATEs this
-- row rather than colliding with it. `share_code` is deliberately left NULL
-- here so the app's generated code is the only one ever used (the column is
-- UNIQUE, and Postgres permits many NULLs).
--
-- Idempotent: re-applying is harmless, and `on conflict do nothing` means an
-- account that already has a profile keeps it.

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (
    id,
    email,
    first_name,
    last_name,
    native_language,
    join_date,
    account_status,
    completed_dates
  ) values (
    new.id,
    new.email,
    -- useSignupForm passes `full_name` as "First Last" in user metadata.
    nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '^\S+\s*', ''), ''),
    new.raw_user_meta_data ->> 'native_language',
    new.created_at,
    'active',
    '{}'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_profile_for_new_user() from public;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();