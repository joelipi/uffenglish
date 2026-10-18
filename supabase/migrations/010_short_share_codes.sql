-- 010: five-character share codes generated server-side.
--
-- New codes are exactly five lowercase characters drawn from
--   abcdefghijkmnopqrstuvwxyz0123456789
-- (every lowercase letter except `l`, plus every digit). The generator skips
-- reserved words (offensive terms, slurs, and a few confusable dictionary
-- words) and any code already present in user_profiles, so collisions and
-- offensive codes are impossible in practice.
--
-- The client no longer mints codes: it calls generate_share_code() and writes
-- the returned value. The trigger below is the backstop for rows created
-- without client involvement (e.g. the auth.users insert trigger).

create table if not exists public.reserved_share_codes (
    word text primary key
);

insert into public.reserved_share_codes (word) values
  ('about'),('admin'),('asses'),('assho'),('beanr'),('bitch'),('boche'),('cocks'),
  ('codes'),('cunts'),('dicks'),('dykes'),('error'),('fagot'),('fatty'),('freak'),
  ('fucks'),('guest'),('guido'),('hoess'),('idiot'),('media'),('moron'),('nigga'),
  ('penis'),('press'),('prick'),('pussy'),('queer'),('reset'),('retar'),('scumb'),
  ('share'),('skank'),('spick'),('teams'),('token'),('trash'),('twats'),('users'),
  ('voids'),('wetbk'),('whore')
on conflict (word) do nothing;

-- Guard: only exact five-character words can ever match a generated code.
delete from public.reserved_share_codes where length(word) <> 5;

create or replace function public.generate_share_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'abcdefghijkmnopqrstuvwxyz0123456789';
  code text;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random() * 35)::int, 1);
    end loop;
    exit when not exists (select 1 from public.user_profiles where share_code = code)
       and not exists (select 1 from public.reserved_share_codes where word = code);
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'could not generate a unique share code';
    end if;
  end loop;
  return code;
end;
$$;

grant execute on function public.generate_share_code() to authenticated, service_role, anon;

create or replace function public.fill_share_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.share_code is null then
    NEW.share_code := public.generate_share_code();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_fill_share_code on public.user_profiles;
create trigger trg_fill_share_code
  before insert or update on public.user_profiles
  for each row
  execute function public.fill_share_code();
EOF
echo written