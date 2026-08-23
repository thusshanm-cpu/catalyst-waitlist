-- ————————————————————————————————————————————————————————————
-- Catalyst — one-time setup. Run the whole file once in Supabase →
-- SQL Editor (~20 seconds). Safe to re-run (idempotent).
--
-- Creates:
--   profiles      — real account profiles (keyed to Supabase Auth users)
--   search_offers — async matching: a search persists up to 5 minutes
--   matches       — a made match, picked up by both sides when online
--   match_events  — funnel analytics (match → call → decision)
-- ————————————————————————————————————————————————————————————

-- ————— Profiles (real accounts) —————
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text,
  name text,
  email text,
  school text,
  program text,
  fields text[],
  verification_status text not null default 'pending', -- pending | approved
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- users manage their own profile only (drop-first so re-runs converge)
drop policy if exists "users can manage their own profile" on public.profiles;
create policy "users can manage their own profile"
  on public.profiles
  for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ————— Async matching —————
create table if not exists public.search_offers (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,          -- the searcher's client id (auth uid or device id)
  role text not null,              -- candidate | employer
  fields text[] not null default '{}',
  anon jsonb,                      -- lightweight anon snapshot (no resume PII at offer time)
  status text not null default 'waiting', -- waiting | claimed | matched | cancelled
  match_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  a_id text not null,
  b_id text not null,
  a_anon jsonb,
  b_anon jsonb,
  field text,
  status text not null default 'pending', -- pending | active | ended
  created_at timestamptz not null default now()
);

-- The matching room is deliberately open (like a public waiting lobby) —
-- it holds only role/field/anons, and the publishable key is in every
-- browser. Real auth-gated matching is the production upgrade.
-- NOTE: these must be the LAST word on these tables; the re-affirm at the
-- bottom of this file guards against partial runs that left RLS enabled.
alter table public.search_offers disable row level security;
alter table public.matches disable row level security;

-- index the common lookup
create index if not exists search_offers_waiting_idx
  on public.search_offers (role, status, expires_at);

-- ————— Funnel analytics —————
create table if not exists public.match_events (
  id       bigint generated always as identity primary key,
  event    text not null,          -- match_started | call_connected | call_failed | peer_left | session_ended | decision
  role     text,
  field    text,
  mode     text,                   -- real | demo
  decision text,
  at       timestamptz not null default now()
);

alter table public.match_events enable row level security;

-- The browser client may write funnel events but never read them.
drop policy if exists "anon can insert match events" on public.match_events;
create policy "anon can insert match events"
  on public.match_events
  for insert
  to anon
  with check (true);

-- ————— Convergence guard —————
-- A partial or repeated run can leave the matching room with RLS enabled
-- (breaking async matching inserts). Re-affirm the intended state so a
-- re-run always converges, no matter what ran before.
alter table public.search_offers disable row level security;
alter table public.matches disable row level security;

-- make sure the tables are in the realtime publication (idempotent via DO)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('search_offers', 'matches')
  ) then
    alter publication supabase_realtime add table public.search_offers;
    alter publication supabase_realtime add table public.matches;
  end if;
end
$$;

drop index if exists search_offers_waiting_idx;
create index if not exists search_offers_waiting_idx
  on public.search_offers (role, status, expires_at);

-- ————— Handy queries (run in the SQL editor) —————
-- select event, count(*) from public.match_events group by 1 order by 2 desc;
-- select role, field, status, count(*) from public.matches group by 1,2,3;
