-- 001_init_user_profiles_and_avatars.sql
-- Migrates Appwrite userprofilestable (database 69e6fc160026cb28cf02) + avatar bucket
-- to Supabase. GitHub integration auto-deploys this on merge to main.
-- Project: jbrbmbmupjfangqvaevx

-- ---------------------------------------------------------------------------
-- Table: user_profiles
-- Replaces Appwrite TablesDB table "userprofilestable" (rowId = auth.users.id)
-- All columns that were written via syncUserMetaDataMutation / SignupForm are
-- represented. JSON string columns (course_progress, lesson_scores) stay as text
-- for zero-change client code; consider jsonb in a later migration.
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  join_date timestamptz,
  account_status text default 'active',
  native_language text,
  english_level text,
  completed_dates text[] default '{}',
  course_progress text,
  lesson_scores text,
  lessons_completed integer default 0,
  counted_lessons text[] default '{}',
  total_fluency_sum numeric default 0,
  recent_fluency_avgs numeric[] default '{}',
  last_lesson_timestamp timestamptz,
  signup_ip text,
  country text,
  region text,
  city text,
  referrer text,
  friend_code text,
  share_code text unique,
  profile_picture_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Keep updated_at fresh
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();

-- Indexes for common queries
create index if not exists idx_user_profiles_share_code on public.user_profiles(share_code);
create index if not exists idx_user_profiles_email on public.user_profiles(email);

-- ---------------------------------------------------------------------------
-- RLS: mirrors Appwrite permission arrays
--   read("any") -> public SELECT (needed for shareCode public profile page)
--   read/update/delete("user:id") -> owner-only writes
-- With "Automatically expose new tables = OFF" and "Enable automatic RLS = ON"
-- (dashboard settings confirmed), we explicitly enable + add policies.
-- ---------------------------------------------------------------------------
alter table public.user_profiles enable row level security;

drop policy if exists "public read" on public.user_profiles;
create policy "public read"
  on public.user_profiles for select
  using (true);

drop policy if exists "owner insert" on public.user_profiles;
create policy "owner insert"
  on public.user_profiles for insert
  with check (auth.uid() = id);

drop policy if exists "owner update" on public.user_profiles;
create policy "owner update"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "owner delete" on public.user_profiles;
create policy "owner delete"
  on public.user_profiles for delete
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Storage bucket: avatars
-- Replaces Appwrite bucket 69e6fc5200010a93b641. Public bucket so
-- supabase.storage.from('avatars').getPublicUrl(path) works without the
-- Appwrite fetch-with-cookie workaround (avatar.service getAvatarBlobUrl).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Storage policies — allow public read, owner write/delete
-- storage.objects has RLS enabled by default; create policies for avatars bucket

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    -- path is <userId>/... — ensure user owns prefix
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
