-- 010: five-character share codes generated server-side.
--
-- New codes are exactly five lowercase characters drawn from
--   abcdefghijkmnopqrstuvwxyz0123456789
-- (every lowercase letter except `l`, plus every digit). The generator skips
-- reserved words (offensive terms, slurs, and a few confusable dictionary
-- words) and any code already present in user_profiles, so collisions and
-- reserved codes are avoided in practice. Rows created without the client
-- (trigger fallback) still go through this function; client-side fallbacks
-- that bypass the RPC may mint a reserved word, but those are rare.

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

create or replace function public.generate_share_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := 'abcdefghijkmnopqrstuvwxyz0123456789';
  code text;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
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

revoke all on function public.generate_share_code() from public;
grant execute on function public.generate_share_code() to authenticated, service_role, anon;

create or replace function public.fill_share_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.share_code is not null then
    if length(NEW.share_code) not in (4, 5) then
      raise exception 'invalid share code length';
    end if;
    if NEW.share_code !~ '^[abcdefghijkmnopqrstuvwxyz0123456789]+$' then
      raise exception 'invalid share code characters';
    end if;
    if exists (select 1 from public.reserved_share_codes where word = NEW.share_code) then
      raise exception 'reserved share code';
    end if;
  else
    NEW.share_code := public.generate_share_code();
  end if;
  return NEW;
end;
$$;

revoke all on function public.fill_share_code() from public;
grant execute on function public.fill_share_code() to authenticated, service_role, anon;

drop trigger if exists trg_fill_share_code on public.user_profiles;
create trigger trg_fill_share_code
  before insert or update on public.user_profiles
  for each row
  execute function public.fill_share_code();

alter table public.reserved_share_codes enable row level security;
revoke all on table public.reserved_share_codes from anon, authenticated;