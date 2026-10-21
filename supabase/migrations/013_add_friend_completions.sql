-- 013_add_friend_completions.sql
-- Lesson-level joint-completion ledger.
--
-- `counted_lessons` is per LEARNER and per LESSON: it cannot say which friend a
-- lesson was done with. A badge derived from it claimed a lesson was done
-- "together" with every partner who happened to offer the same lesson — and
-- showed nothing on a partner's profile unless the viewer was the partner.
-- Repeating a lesson with several friends is expected, so the pair belongs in
-- the record.
--
-- Writes go through record_friend_completion() (SECURITY DEFINER), the same
-- completion that credits the friendship, so a client cannot forge one. A
-- learner may read only their OWN rows: `auth.uid() = actor_id`. The owner's
-- identity, inbox and other learners' completions stay private.

create table if not exists public.friend_completions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  constraint friend_completions_no_self check (actor_id <> owner_id),
  constraint friend_completions_unique unique (actor_id, owner_id, course_id, lesson_id)
);

create index if not exists idx_friend_completions_actor_owner
  on public.friend_completions (actor_id, owner_id);

alter table public.friend_completions enable row level security;

-- The badge reads the viewer's own completions with one owner. Nothing else is
-- readable: not the owner's view of the pair, not another learner's history.
drop policy if exists "actor reads own completions" on public.friend_completions;
create policy "actor reads own completions"
  on public.friend_completions for select
  to authenticated
  using (auth.uid() = actor_id);

grant select on table public.friend_completions to authenticated;
-- Least privilege: the SECURITY DEFINER RPC is the only writer.
-- (No insert/update/delete grants to anon or authenticated.)

-- Backfill what the inbox proves. A friend_response row IS a real completion of
-- that lesson by the actor through the owner's link (record_friend_response
-- only fires after a successful publish on the answer side of a chain). The
-- inbox keeps ONE row per (recipient, actor, type), so this recovers the LATEST
-- joint lesson per pair; older ones were overwritten and cannot be
-- reconstructed — the ledger is complete from this migration onward.
insert into public.friend_completions (actor_id, owner_id, course_id, lesson_id)
select n.actor_id, n.recipient_id, n.course_id, n.lesson_id
from public.user_notifications n
where n.type = 'friend_response'
  and n.actor_id <> n.recipient_id
  and btrim(n.course_id) <> ''
  and btrim(n.lesson_id) <> ''
on conflict (actor_id, owner_id, course_id, lesson_id) do nothing;

-- Same atomic friendship credit as 007, now also recording the lesson-level
-- pair. Actor is always auth.uid(); the owner is resolved from their share
-- code. Self-completion and a blank/unknown owner stay a no-op.
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

  -- The joint completion itself. Idempotent: re-doing the lesson with the same
  -- friend refreshes the timestamp instead of stacking rows. Only real lesson
  -- keys are stored; a blank id would make a meaningless row.
  if btrim(coalesce(p_course_id, '')) <> '' and btrim(coalesce(p_lesson_id, '')) <> '' then
    insert into public.friend_completions (actor_id, owner_id, course_id, lesson_id)
    values (v_actor, v_owner, p_course_id, p_lesson_id)
    on conflict (actor_id, owner_id, course_id, lesson_id)
    do update set completed_at = now();
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
