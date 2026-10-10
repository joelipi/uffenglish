-- 007_friend_credit.sql
-- Friend-completion credit: when another user completes a friend lesson through
-- your share link, your profile records them.
--
-- Columns on user_profiles:
--   friends       text[]  ordered completer user-ids on the OWNER's row,
--                         appended at the end, never duplicated.
--                         Friend count = cardinality(friends).
--   referrals     integer completer count whose FIRST completed friend lesson
--                         was with this owner.
--   friend_owners text[]  ordered owner user-ids on the COMPLETER's row,
--                         appended at the end, never duplicated. Empty-before-
--                         append means "first friend lesson ever" -> the owner
--                         earns a referral. Private: never exposed publicly.
--
-- Writes go through record_friend_completion() (SECURITY DEFINER, same shape
-- as 005's record_friend_response): RLS allows owner-only updates, so a client
-- can never write another user's row directly. The RPC is idempotent
-- (append-if-absent on both arrays; referral only when the completer's array
-- was empty), so retries and double-fires are safe. Self-completion is a no-op.

alter table public.user_profiles
  add column if not exists friends text[] not null default '{}',
  add column if not exists referrals integer not null default 0,
  add column if not exists friend_owners text[] not null default '{}';

-- Public profile display needs the counts, never who-completed-with-whom.
grant select (friends, referrals) on table public.user_profiles to anon;

-- Refresh the safe public view with the two display columns.
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
  friend_links,
  friends,
  referrals
from public.user_profiles
where share_code is not null;

grant select on public.public_profiles to anon, authenticated;

-- Atomic cross-row credit. Actor is always auth.uid() (never a parameter, so a
-- caller cannot forge credit for or from anyone else); the owner is resolved
-- from their share code. Unknown owner, blank code, or self-completion: no-op,
-- never an error to the caller.
create or replace function public.record_friend_completion(
  p_owner_share_code text,
  p_course_id text,
  p_lesson_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_actor_first boolean := false;
begin
  if v_actor is null then
    raise exception 'record_friend_completion: not authenticated' using errcode = '28000';
  end if;
  if p_owner_share_code is null or btrim(p_owner_share_code) = '' then
    return;
  end if;

  select p.id into v_owner
  from public.user_profiles p
  where lower(p.share_code) = lower(btrim(p_owner_share_code))
  limit 1;

  -- Unknown owner or self-completion: no-op, never an error to the caller.
  if v_owner is null or v_owner = v_actor then
    return;
  end if;

  -- The completer's ordered owner list. Empty-before-append means this is
  -- their first completed friend lesson with anyone -> referral for the owner.
  -- Read the pre-update state first: RETURNING would see the new array.
  select (p.friend_owners is null or array_length(p.friend_owners, 1) is null)
    into v_actor_first
  from public.user_profiles p
  where p.id = v_actor;

  update public.user_profiles p
  set friend_owners =
    case when array_position(p.friend_owners, v_owner::text) is null
      then p.friend_owners || v_owner::text
      else p.friend_owners
    end
  where p.id = v_actor;

  -- The owner's ordered completer list (append-if-absent: unique users), plus
  -- the referral counter when the completer is first-timing.
  update public.user_profiles p
  set friends =
    case when array_position(p.friends, v_actor::text) is null
      then p.friends || v_actor::text
      else p.friends
    end,
    referrals = p.referrals + (case when v_actor_first then 1 else 0 end)
  where p.id = v_owner;
end;
$$;

revoke all on function public.record_friend_completion(text, text, text) from public, anon;
grant execute on function public.record_friend_completion(text, text, text) to authenticated;
