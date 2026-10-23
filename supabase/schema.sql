create table if not exists public.rv_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_key text generated always as (lower(btrim(username))) stored unique,
  created_at timestamptz not null default now(),
  constraint rv_users_username_not_empty check (length(btrim(username)) > 0)
);

create table if not exists public.rv_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('color', 'gradient', 'image')),
  solid_hex text,
  gradient_start text,
  gradient_end text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint rv_colors_name_not_empty check (length(btrim(name)) > 0),
  constraint rv_colors_background check (
    (kind = 'color' and solid_hex ~ '^#[0-9A-Fa-f]{6}$' and gradient_start is null and gradient_end is null and image_path is null)
    or (kind = 'gradient' and solid_hex is null and gradient_start ~ '^#[0-9A-Fa-f]{6}$' and gradient_end ~ '^#[0-9A-Fa-f]{6}$' and image_path is null)
    or (kind = 'image' and solid_hex is null and gradient_start is null and gradient_end is null and image_path is not null)
  )
);

create table if not exists public.rv_user_colors (
  user_id uuid not null references public.rv_users(id) on delete cascade,
  color_id uuid not null references public.rv_colors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, color_id)
);

create table if not exists public.rv_hosts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.rv_host_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_key text generated always as (lower(btrim(username))) stored unique,
  created_at timestamptz not null default now(),
  constraint rv_host_profiles_username_not_empty check (length(btrim(username)) between 3 and 32)
);

with existing_accounts as (
  select
    id,
    coalesce(nullif(left(btrim(raw_user_meta_data ->> 'username'), 32), ''), 'Host-' || left(id::text, 8)) as base_name
  from auth.users
),
numbered_accounts as (
  select
    id,
    base_name,
    row_number() over (partition by lower(base_name) order by id) as duplicate_number
  from existing_accounts
)
insert into public.rv_host_profiles (user_id, username)
select
  id,
  case when duplicate_number = 1 then base_name else left(base_name, 23) || '-' || left(id::text, 8) end
from numbered_accounts
on conflict (user_id) do nothing;

create table if not exists public.rv_saved_seasons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  season_id text not null,
  season_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, season_id),
  constraint rv_saved_seasons_data_is_object check (jsonb_typeof(season_data) = 'object')
);

create table if not exists public.rv_point_systems (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_name text not null default 'RV Host',
  name text not null check (length(btrim(name)) > 0),
  name_key text generated always as (lower(btrim(name))) stored unique,
  participant_count integer not null check (participant_count between 20 and 48),
  event_limit integer not null check (event_limit in (20, 22)),
  point_schedules jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rv_point_systems_schedules_are_array check (jsonb_typeof(point_schedules) = 'array')
);

create or replace function public.rv_is_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rv_hosts where user_id = (select auth.uid())
  );
$$;

alter table public.rv_users enable row level security;
alter table public.rv_colors enable row level security;
alter table public.rv_user_colors enable row level security;
alter table public.rv_hosts enable row level security;
alter table public.rv_host_profiles enable row level security;
alter table public.rv_saved_seasons enable row level security;
alter table public.rv_point_systems enable row level security;

grant select on public.rv_users, public.rv_colors, public.rv_user_colors to anon, authenticated;
grant insert, update, delete on public.rv_users, public.rv_colors, public.rv_user_colors to authenticated;
grant select on public.rv_hosts to authenticated;
grant select, insert, update on public.rv_host_profiles to authenticated;
grant select, insert, update, delete on public.rv_saved_seasons to authenticated;
grant select, insert, update, delete on public.rv_point_systems to authenticated;

revoke all on function public.rv_is_host() from public;
grant execute on function public.rv_is_host() to authenticated;

drop policy if exists "RV users are publicly readable" on public.rv_users;
create policy "RV users are publicly readable"
  on public.rv_users for select to anon, authenticated using (true);

drop policy if exists "RV hosts manage users" on public.rv_users;
create policy "RV hosts manage users"
  on public.rv_users for all to authenticated
  using ((select public.rv_is_host()))
  with check ((select public.rv_is_host()));

drop policy if exists "RV colors are publicly readable" on public.rv_colors;
create policy "RV colors are publicly readable"
  on public.rv_colors for select to anon, authenticated using (true);

drop policy if exists "RV hosts manage colors" on public.rv_colors;
create policy "RV hosts manage colors"
  on public.rv_colors for all to authenticated
  using ((select public.rv_is_host()))
  with check ((select public.rv_is_host()));

drop policy if exists "RV user color history is publicly readable" on public.rv_user_colors;
create policy "RV user color history is publicly readable"
  on public.rv_user_colors for select to anon, authenticated using (true);

drop policy if exists "RV hosts manage user color history" on public.rv_user_colors;
create policy "RV hosts manage user color history"
  on public.rv_user_colors for all to authenticated
  using ((select public.rv_is_host()))
  with check ((select public.rv_is_host()));

drop policy if exists "RV hosts can read their host record" on public.rv_hosts;
create policy "RV hosts can read their host record"
  on public.rv_hosts for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Signed-in users can read host display names" on public.rv_host_profiles;
create policy "Signed-in users can read host display names"
  on public.rv_host_profiles for select to authenticated
  using (true);

drop policy if exists "Users manage their own host profile" on public.rv_host_profiles;
create policy "Users manage their own host profile"
  on public.rv_host_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Owners manage their saved seasons" on public.rv_saved_seasons;
create policy "Owners manage their saved seasons"
  on public.rv_saved_seasons for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Signed-in users can read shared point systems" on public.rv_point_systems;
create policy "Signed-in users can read shared point systems"
  on public.rv_point_systems for select to authenticated
  using (true);

drop policy if exists "Creators can publish point systems" on public.rv_point_systems;
create policy "Creators can publish point systems"
  on public.rv_point_systems for insert to authenticated
  with check (creator_id = (select auth.uid()));

drop policy if exists "Creators can update their point systems" on public.rv_point_systems;
create policy "Creators can update their point systems"
  on public.rv_point_systems for update to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

drop policy if exists "Creators can delete their point systems" on public.rv_point_systems;
create policy "Creators can delete their point systems"
  on public.rv_point_systems for delete to authenticated
  using (creator_id = (select auth.uid()));

create or replace function public.rv_create_host_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rv_host_profiles (user_id, username)
  values (new.id, btrim(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

drop trigger if exists rv_create_host_profile_after_signup on auth.users;
create trigger rv_create_host_profile_after_signup
  after insert on auth.users
  for each row execute function public.rv_create_host_profile();

create or replace function public.rv_set_point_system_creator_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select username into new.creator_name
  from public.rv_host_profiles
  where user_id = new.creator_id;
  if new.creator_name is null then
    raise exception 'The point system creator profile does not exist.';
  end if;
  return new;
end;
$$;

drop trigger if exists rv_set_point_system_creator_name_before_write on public.rv_point_systems;
create trigger rv_set_point_system_creator_name_before_write
  before insert or update on public.rv_point_systems
  for each row execute function public.rv_set_point_system_creator_name();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rv-color-backgrounds', 'rv-color-backgrounds', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rv-season-backgrounds', 'rv-season-backgrounds', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "RV color backgrounds are publicly readable" on storage.objects;
create policy "RV color backgrounds are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'rv-color-backgrounds');

drop policy if exists "RV hosts manage color backgrounds" on storage.objects;
create policy "RV hosts manage color backgrounds"
  on storage.objects for all to authenticated
  using (bucket_id = 'rv-color-backgrounds' and (select public.rv_is_host()))
  with check (bucket_id = 'rv-color-backgrounds' and (select public.rv_is_host()));

drop policy if exists "Season owners manage private backgrounds" on storage.objects;
create policy "Season owners manage private backgrounds"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'rv-season-backgrounds'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'rv-season-backgrounds'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
