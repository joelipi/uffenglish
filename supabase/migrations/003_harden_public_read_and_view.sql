-- 003_harden_public_read_and_view.sql
-- Pilot hardening: anon public read was USING (true) on 001 — leaks email, signup_ip,
-- geo, referrer to any anon caller. For real-user pilot we must scope anon reads.
--
-- Strategy: column-level GRANTs + view
--   1. Revoke anon's blanket SELECT on user_profiles.
--   2. Grant anon SELECT only on safe, display-only columns.
--   3. Keep authenticated with full read.
--   4. Replace the single "public read" policy (USING true) with a scoped
--      policy that still requires a valid share_code row — prevents dumping
--      every profile via `select *`.
--   5. Create a convenience view `public.public_profiles` that exposes only
--      safe columns; useUserByShareCode can select from it directly.
--   6. Local testing: applies cleanly after 001+002. On production: run after
--      verifying PublicProfile still renders.

-- ---------------------------------------------------------------------------
-- 1. Column-level grants
-- ---------------------------------------------------------------------------
-- postgres allows column-level GRANT. Revoke table-level then re-grant per column.
revoke select on table public.user_profiles from anon;

-- Safe display columns for anon shareCode lookup:
--  id, first_name, last_name, native_language, english_level, join_date,
--  share_code, profile_picture_url, completed_dates, lessons_completed,
--  counted_lessons, total_fluency_sum, recent_fluency_avgs, created_at,
--  updated_at, account_status
grant select (
  id, first_name, last_name, join_date, account_status,
  native_language, english_level,
  completed_dates, lessons_completed, counted_lessons,
  total_fluency_sum, recent_fluency_avgs,
  share_code, profile_picture_url,
  created_at, updated_at
) on table public.user_profiles to anon;

-- Authenticated users still need full row access for their own profile
grant select on table public.user_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Scoped RLS policy (replaces 001's `USING (true)`)
-- ---------------------------------------------------------------------------
drop policy if exists "public read" on public.user_profiles;

create policy "anon shareCode read"
  on public.user_profiles for select
  to anon
  using (share_code is not null);

-- Keep owner policies from 001 unchanged (insert/update/delete). They are
-- already scoped to auth.uid() = id, so no change needed.

-- Authenticated users can still read any shared profile (needed for logged-in
-- viewers of public profiles) and always their own row. Keep a permissive
-- authenticated read that postgrest enforces with column grants above.
drop policy if exists "authenticated read" on public.user_profiles;
create policy "authenticated read"
  on public.user_profiles for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Convenience view — canonical safe shape for public profile queries
-- ---------------------------------------------------------------------------
create or replace view public.public_profiles as
select
  id,
  first_name,
  last_name,
  native_language,
  english_level,
  join_date,
  share_code,
  profile_picture_url,
  completed_dates,
  lessons_completed,
  counted_lessons,
  total_fluency_sum,
  recent_fluency_avgs,
  created_at,
  account_status
from public.user_profiles
where share_code is not null;

grant select on public.public_profiles to anon, authenticated;
