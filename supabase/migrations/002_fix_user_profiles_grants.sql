-- 002_fix_user_profiles_grants.sql
-- Fix 42501 permission denied after 001 — with "Automatically expose new tables = OFF"
-- (your Dashboard setting), Data API roles get no table privileges by default.
-- Policies in 001 are not enough; GRANTs are required for anon/authenticated to hit the API.

-- Schema usage
grant usage on schema public to anon, authenticated;

-- Table privileges: public read (for shareCode anon lookup) + authenticated full
grant select on table public.user_profiles to anon, authenticated;
grant insert, update, delete on table public.user_profiles to authenticated;

-- Ensure sequences / serials if any (future share_code generation) usable
-- No sequence for user_profiles PK (uuid), so nothing else needed.
