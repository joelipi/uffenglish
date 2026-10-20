-- 011_record_friend_link.sql
-- Records the follow-up friend link on the learner's OWN profile, right after
-- a friend lesson's clip is published.
--
-- Why this moves server-side. The client used to READ the whole `friend_links`
-- map, merge one entry into it and write the map back with an UPDATE on
-- `user_profiles`. Two things could lose that link without the app ever
-- learning about it:
--   * a zero-row UPDATE is NOT an error in PostgREST — when the row is
--     filtered out, the write silently does nothing and the mutation reports
--     success;
--   * the read is a separate round trip that can fail on its own.
-- The learner then opened their public profile and saw "all your lessons have
-- expired" right after recording one, and the link they had just sent to
-- their friends was nowhere to be found. Nothing in the UI said so.
--
-- This RPC merges the entry atomically on the server:
--   * the owner is the caller (auth.uid()) — the client cannot write to
--     another user's row and no longer has to know its own user id;
--   * one statement, one atomic jsonb_set merge — two lessons recorded in
--     parallel can no longer overwrite each other's entry;
--   * re-recording the same lesson refreshes the entry (a fresh addedAt),
--     restarting the 48h window exactly like the client's merge did;
--   * the share code is read from the caller's own row, so a client cannot
--     forge a link for somebody else;
--   * a failure is an ERROR the caller sees, never a silent no-op.
--
-- The entry shape is the one the public profile renders: courseId,
-- courseName, recordedLessonId, lessonId (the follow-up), shareCode,
-- lessonTitle, addedAt.

create or replace function public.record_friend_link(
  p_course_id text,
  p_recorded_lesson_id text,
  p_next_lesson_id text,
  p_course_name text,
  p_lesson_title text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text;
  v_entry jsonb;
begin
  if v_actor is null then
    raise exception 'record_friend_link: not authenticated' using errcode = '28000';
  end if;

  -- Nothing to record without a course, the lesson that was recorded and the
  -- follow-up it points at: the profile link is exactly that pair.
  if p_course_id is null or btrim(p_course_id) = ''
     or p_recorded_lesson_id is null or btrim(p_recorded_lesson_id) = ''
     or p_next_lesson_id is null or btrim(p_next_lesson_id) = '' then
    return false;
  end if;

  -- One entry per recorded lesson, so a learner who recorded several lessons
  -- of a course keeps a link for each of them.
  v_key := p_course_id || ':' || p_recorded_lesson_id;

  select jsonb_build_object(
    'courseId', p_course_id,
    'courseName', coalesce(p_course_name, ''),
    'recordedLessonId', p_recorded_lesson_id,
    'lessonId', p_next_lesson_id,
    'shareCode', coalesce(p.share_code, ''),
    'lessonTitle', coalesce(p_lesson_title, ''),
    'addedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  into v_entry
  from public.user_profiles p
  where p.id = v_actor;

  -- No profile row for the caller: nothing to attach the link to.
  if v_entry is null then
    return false;
  end if;

  update public.user_profiles p
  set friend_links = jsonb_set(
    coalesce(p.friend_links, '{}'::jsonb),
    array[v_key],
    v_entry,
    true
  )
  where p.id = v_actor;

  return true;
end;
$$;

revoke all on function public.record_friend_link(text, text, text, text, text) from public, anon;
grant execute on function public.record_friend_link(text, text, text, text, text) to authenticated;
