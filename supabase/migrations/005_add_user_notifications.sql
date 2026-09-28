-- 005_add_user_notifications.sql
-- In-app notification inbox. Created server-side by record_friend_response();
-- the recipient reads and marks-read their own rows via RLS. No insert grant,
-- so a client cannot forge a notification.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  course_id text not null default '',
  lesson_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint user_notifications_no_self check (recipient_id <> actor_id)
);

-- One notification per (recipient, actor, type); a re-answer refreshes the
-- existing row instead of stacking duplicates. Deliberately NOT keyed on
-- course_id/lesson_id: those are caller-supplied, so including them would let any
-- authenticated caller flood a victim's inbox with one row per made-up course.
-- The unique key therefore contains no attacker-controlled text. course_id and
-- lesson_id are stored as context only; the UI does not render them.
create unique index if not exists uq_user_notifications_dedupe
  on public.user_notifications (recipient_id, actor_id, type);

-- Inbox query: recipient's rows, newest first.
create index if not exists idx_user_notifications_recipient_created
  on public.user_notifications (recipient_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists "recipient read" on public.user_notifications;
create policy "recipient read"
  on public.user_notifications for select
  to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "recipient update" on public.user_notifications;
create policy "recipient update"
  on public.user_notifications for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

grant select on table public.user_notifications to authenticated;
-- Least privilege: the recipient may only clear read_at, never edit the payload.
grant update (read_at) on table public.user_notifications to authenticated;

-- SECURITY DEFINER: derives actor from auth.uid(), recipient from the share
-- code, and the actor display name from the actor's own profile.
create or replace function public.record_friend_response(
  p_recipient_share_code text,
  p_course_id text,
  p_lesson_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_actor_code text;
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'record_friend_response: not authenticated' using errcode = '28000';
  end if;
  if p_recipient_share_code is null or btrim(p_recipient_share_code) = '' then
    return;
  end if;

  select p.id into v_recipient
  from public.user_profiles p
  where lower(p.share_code) = lower(btrim(p_recipient_share_code))
  limit 1;

  -- Unknown recipient or self-notification: no-op, never an error to the caller.
  if v_recipient is null or v_recipient = v_actor then
    return;
  end if;

  select p.share_code,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    into v_actor_code, v_actor_name
  from public.user_profiles p
  where p.id = v_actor;

  insert into public.user_notifications
    (recipient_id, actor_id, type, course_id, lesson_id, payload)
  values
    (v_recipient, v_actor, 'friend_response',
     coalesce(p_course_id, ''), coalesce(p_lesson_id, ''),
     jsonb_build_object(
       'actorShareCode', coalesce(v_actor_code, ''),
       'actorName', coalesce(v_actor_name, '')
     ))
  on conflict (recipient_id, actor_id, type)
  do update set
    created_at = now(),
    read_at = null,
    course_id = excluded.course_id,
    lesson_id = excluded.lesson_id,
    payload = excluded.payload;
end;
$$;

revoke all on function public.record_friend_response(text, text, text) from public, anon;
grant execute on function public.record_friend_response(text, text, text) to authenticated;
