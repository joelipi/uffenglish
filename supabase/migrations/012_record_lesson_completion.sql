-- 012_record_lesson_completion.sql
-- Records a lesson completion on the learner's OWN profile row.
--
-- Why this moves server-side. The counters used to be written by the client:
-- it read the row (or trusted its store copy), added one to
-- `lessons_completed`, added the lesson key to `counted_lessons`, added today
-- to `completed_dates` and wrote the whole thing back with an upsert. That
-- write can be lost without any error reaching the app — a zero-row upsert is
-- NOT an error in PostgREST, the baseline the client added to came from a
-- store copy that may not match the row, and the whole write was skipped when
-- the store had no profile yet. A learner who finished a lesson (and even
-- published the video) was then told by their own public profile that they had
-- completed nothing.
--
-- This RPC owns the counters:
--   * the learner is the caller (auth.uid()) — nobody can count a lesson for
--     somebody else;
--   * the row is read and incremented atomically, so the baseline is the row's
--     own truth (no client baseline, no lost update between two completions);
--   * `counted_lessons` stays the UNIQUE set of completed lessons and
--     `completed_dates` the unique set of active days;
--   * a failure is an ERROR the caller sees, never a silent no-op.
--
-- It returns the resulting counters so the client can update its store without
-- guessing: { lessons_completed, counted_lessons, completed_dates,
-- is_first_completion }.

create or replace function public.record_lesson_completion(
  p_course_id text,
  p_completed_lesson_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text;
  v_today text;
  v_result record;
begin
  if v_actor is null then
    raise exception 'record_lesson_completion: not authenticated' using errcode = '28000';
  end if;

  if p_course_id is null or btrim(p_course_id) = ''
     or p_completed_lesson_id is null or btrim(p_completed_lesson_id) = '' then
    return null;
  end if;

  -- The counted key: `<courseId>_<lessonId>` (the existing convention the
  -- profile's "counted together" match and the signup credit both use).
  v_key := p_course_id || '_' || p_completed_lesson_id;
  v_today := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD');

  -- One statement: read the pre-update state and update against the same
  -- snapshot, so the increment is atomic and the "was this the first
  -- completion of this lesson" answer comes from the row's own prior state.
  with prior as (
    select coalesce(p.counted_lessons, '{}')::text[] as counted,
           coalesce(p.completed_dates, '{}')::text[] as days
    from public.user_profiles p
    where p.id = v_actor
  ), updated as (
    update public.user_profiles p
    set lessons_completed = coalesce(p.lessons_completed, 0) + 1,
        counted_lessons = case
          when p.counted_lessons is null or not (p.counted_lessons @> ARRAY[v_key])
            then coalesce(p.counted_lessons, '{}') || v_key
          else p.counted_lessons
        end,
        completed_dates = case
          when p.completed_dates is null or not (p.completed_dates @> ARRAY[v_today])
            then coalesce(p.completed_dates, '{}') || v_today
          else p.completed_dates
        end
    where p.id = v_actor
    returning p.*
  )
  select
    u.lessons_completed,
    u.counted_lessons,
    u.completed_dates,
    not (prior.counted @> ARRAY[v_key]) as is_first_completion,
    not (prior.days @> ARRAY[v_today]) as day_added
  into v_result
  from prior, updated u;

  if v_result.lessons_completed is null then
    return null;
  end if;

  return jsonb_build_object(
    'lessons_completed', v_result.lessons_completed,
    'counted_lessons', v_result.counted_lessons,
    'completed_dates', v_result.completed_dates,
    -- The fluency average admits only the FIRST completion of a lesson, so the
    -- caller needs to know whether this completion was that first one.
    'is_first_completion', v_result.is_first_completion,
    -- Whether today was added to the ledger by THIS completion (the day
    -- counter only moves on the first completion of a day).
    'day_added', v_result.day_added
  );
end;
$$;

revoke all on function public.record_lesson_completion(text, text) from public, anon;
grant execute on function public.record_lesson_completion(text, text) to authenticated;
