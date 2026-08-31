-- 002_fix_user_profiles_grants.sql
-- Fixes 42501 "permission denied for table user_profiles" on signup.
-- RLS policies were created in 001 but no table GRANTs were issued.
-- In Postgres, RLS + GRANT are both required: policy = row filter, grant = capability.
-- Without GRANT INSERT TO authenticated, supabase.from('user_profiles').insert()
-- at src/components/auth/SignupForm.jsx:45 fails even though
-- "owner insert" WITH CHECK (auth.uid() = id) would otherwise pass.
-- Also fixes anon SELECT for public profile lookups (share_code) at src/modules/api/api.js:293.

-- Ensure schema usage (idempotent; typically already granted by Supabase)
grant usage on schema public to anon, authenticated;

-- Authenticated users: need full DML — insert on signup, upsert for geo/referrer
-- (src/modules/user/collect-signup-data.js:39 -> api.js:178/275), update/delete for profile edits
grant select, insert, update, delete on public.user_profiles to authenticated;

-- Anon: needs SELECT only, because "public read" policy (001:69-72, using(true))
-- is used for unauthenticated share_code lookups (useUserByShareCode)
grant select on public.user_profiles to anon;
