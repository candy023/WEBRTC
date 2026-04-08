create table if not exists public.rooms (
  slug text primary key,
  display_name text not null,
  room_kind text not null check (room_kind in ('work', 'poker')),
  skyway_room_name text not null,
  media_mode text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  ui_config jsonb not null default '{}'::jsonb
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.banned_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;
alter table public.profiles enable row level security;
alter table public.banned_users enable row level security;

drop policy if exists "rooms_select_authenticated" on public.rooms;
create policy "rooms_select_authenticated"
  on public.rooms
  for select
  to authenticated
  using (true);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "banned_users_select_own" on public.banned_users;
create policy "banned_users_select_own"
  on public.banned_users
  for select
  to authenticated
  using (auth.uid() = user_id);

insert into public.rooms (
  slug,
  display_name,
  room_kind,
  skyway_room_name,
  media_mode,
  sort_order,
  is_active,
  ui_config
)
values
  (
    'work-room',
    'Work Room',
    'work',
    'work-room',
    'sfu',
    10,
    true,
    '{"layout":"work-default"}'::jsonb
  ),
  (
    'poker-room',
    'Poker Room',
    'poker',
    'poker-room',
    'sfu',
    20,
    true,
    '{"layout":"poker-default"}'::jsonb
  )
on conflict (slug) do update
set
  display_name = excluded.display_name,
  room_kind = excluded.room_kind,
  skyway_room_name = excluded.skyway_room_name,
  media_mode = excluded.media_mode,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  ui_config = excluded.ui_config;
