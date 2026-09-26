-- 004_add_friend_links_to_profiles.sql
-- Publicly readable friend-challenge answer-lesson links, stored as jsonb on
-- user_profiles. Follows 003_harden_public_read_and_view.sql: add the column to
-- the anon column GRANT and the public_profiles view. No new table, no new RLS
-- policy. Expiry (48h from each entry's addedAt) is a render-time rule; rows are
-- never deleted by this feature.
--
-- Shape (one entry per course, keyed by courseId):
--   { "friend": { "courseId": "friend", "shareCode": "ab12",
--                 "addedAt": "2026-09-24T11:00:00.000Z" } }

alter table public.user_profiles
  add column if not exists friend_links jsonb not null default '{}'::jsonb;

-- 003 revoked anon's table-level SELECT and re-granted a fixed column list;
-- extend it with the new column. Only link data (course/shareCode/timestamp) is
-- exposed, and only on rows that already have a share_code.
grant select (friend_links) on table public.user_profiles to anon;

-- Refresh the safe public view. CREATE OR REPLACE allows appending the new
-- column at the end; keep the existing anon/authenticated read.
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
  account_status,
  friend_links
from public.user_profiles
where share_code is not null;

grant select on public.public_profiles to anon, authenticated;
