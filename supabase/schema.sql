-- ————————————————————————————————————————————————————————————
-- Catalyst — one-time setup. Run the whole file once in Supabase →
-- SQL Editor (~20 seconds). Safe to re-run (idempotent).
--
-- Creates:
--   profiles      — real account profiles (keyed to Supabase Auth users)
--   search_offers — async matching: a search persists up to 5 minutes
--   matches       — a made match, picked up by both sides when online
--   match_events  — funnel analytics (match → call → decision)
--   function_usage — rate-limit counter for the session-summary edge fn
--   appointment_slots — startups publish open call slots by industry (no company info)
--   appointments      — booked calls; startup sees the candidate's name
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
  claimed_by text,                 -- who claimed the offer (their auth uid)
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

-- idempotent column for pre-existing installs (create table won't add it)
alter table public.search_offers add column if not exists claimed_by text;

-- ————— Auth-gated matching room —————
-- Only signed-in users can use async matching. RLS is ON with explicit
-- policies:
--   · anyone signed in can read waiting offers and claim them
--     (claim = update a waiting offer to claimed → matched)
--   · an owner can read / update / delete their own offers
--   · a match row is visible only to its two participants
-- Logged-out demo/preview users fall back to the legacy simultaneous path.
alter table public.search_offers enable row level security;
alter table public.matches enable row level security;

-- searchers can see waiting offers; owners and claimers can always see
-- their own (claimed/matched rows must stay visible to both, because an
-- UPDATE's new row also has to satisfy the SELECT policies)
drop policy if exists "read waiting or own offers" on public.search_offers;
create policy "read waiting or own offers"
  on public.search_offers
  for select to authenticated
  using (status = 'waiting' or owner_id = auth.uid()::text or claimed_by = auth.uid()::text);

-- you can only post an offer for yourself
drop policy if exists "post own offer" on public.search_offers;
create policy "post own offer"
  on public.search_offers
  for insert to authenticated
  with check (owner_id = auth.uid()::text and status = 'waiting');

-- claim a waiting offer (status → claimed/matched), or manage your own;
-- `using` allows updating waiting+claimed rows so the two-step claim works;
-- the claimer records themselves in claimed_by (also keeps the new row
-- visible to them under the SELECT policy)
drop policy if exists "claim or manage own offer" on public.search_offers;
create policy "claim or manage own offer"
  on public.search_offers
  for update to authenticated
  using (status in ('waiting', 'claimed') or owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text or claimed_by = auth.uid()::text or status in ('claimed', 'matched'));

-- clean up your own offers
drop policy if exists "delete own offer" on public.search_offers;
create policy "delete own offer"
  on public.search_offers
  for delete to authenticated
  using (owner_id = auth.uid()::text);

-- a match is private to its two participants
drop policy if exists "read own matches" on public.matches;
create policy "read own matches"
  on public.matches
  for select to authenticated
  using (a_id = auth.uid()::text or b_id = auth.uid()::text);

-- you can only create a match you're part of (the claimer is a_id)
drop policy if exists "create match as participant" on public.matches;
create policy "create match as participant"
  on public.matches
  for insert to authenticated
  with check (a_id = auth.uid()::text or b_id = auth.uid()::text);

-- participants can update their own matches (pending → active → ended)
drop policy if exists "update own matches" on public.matches;
create policy "update own matches"
  on public.matches
  for update to authenticated
  using (a_id = auth.uid()::text or b_id = auth.uid()::text)
  with check (a_id = auth.uid()::text or b_id = auth.uid()::text);

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

-- Only signed-in users may write funnel events (never read them). This
-- closes the anon spam hole: anonymous visitors (the public waitlist demo)
-- can no longer inject junk rows. Real funnel data comes from real accounts,
-- which send events from authenticated sessions.
drop policy if exists "anon can insert match events" on public.match_events;
drop policy if exists "authenticated can insert match events" on public.match_events;
create policy "authenticated can insert match events"
  on public.match_events
  for insert
  to authenticated
  with check (true);

-- Hygiene: only known event names, and nothing oversized.
alter table public.match_events drop constraint if exists match_events_event_whitelist;
alter table public.match_events add constraint match_events_event_whitelist
  check (event in ('match_started','call_connected','call_failed','peer_left','session_ended','decision','appointment_created','appointment_booked','appointment_joined'));
alter table public.match_events drop constraint if exists match_events_len;
alter table public.match_events add constraint match_events_len
  check (length(event) <= 48
     and length(coalesce(role,''))   <= 32
     and length(coalesce(field,''))  <= 64
     and length(coalesce(mode,''))   <= 16
     and length(coalesce(decision,'')) <= 256);

-- ————— Edge-function rate limiting —————
-- `session-summary` writes one row per call (via its service-role key) so it
-- can enforce a per-IP window limit + global daily cap. RLS is ON with NO
-- policies: external clients (anon or authenticated) get permission denied;
-- only the edge function's service role can touch this table.
create table if not exists public.function_usage (
  id        bigint generated always as identity primary key,
  ip        text not null,
  tag       text not null default 'session-summary',
  called_at timestamptz not null default now()
);

alter table public.function_usage enable row level security;

create index if not exists function_usage_ip_idx on public.function_usage (ip, called_at);
create index if not exists function_usage_at_idx on public.function_usage (called_at);

-- ————— Booked calls (appointments) —————
-- Startups publish open call slots by industry; candidates book them and
-- the call runs on the live-session interface. Privacy by construction:
--   · a slot row carries NO company identity — only the industry (field),
--     day/time and duration. Candidates can never read the startup's
--     identity, even through the API.
--   · the booking snapshots the candidate's name/school/program, which is
--     all the startup sees before the call.
create table if not exists public.appointment_slots (
  id           uuid primary key default gen_random_uuid(),
  owner_id     text not null,               -- startup's auth uid (or device id)
  field        text not null,               -- industry id — the only identity candidates see
  day          date not null,
  time         text not null,               -- e.g. '2:00 PM'
  duration_min int not null default 30 check (duration_min between 5 and 120),
  status       text not null default 'open', -- open | booked
  created_at   timestamptz not null default now()
);

alter table public.appointment_slots enable row level security;

-- anyone (anon + signed-in) can read OPEN slots — they contain no company info
drop policy if exists "read open slots" on public.appointment_slots;
create policy "read open slots"
  on public.appointment_slots
  for select
  to public
  using (status = 'open');

-- owners can always see their own slots (booked ones included)
drop policy if exists "owners read own slots" on public.appointment_slots;
create policy "owners read own slots"
  on public.appointment_slots
  for select
  to authenticated
  using (owner_id = auth.uid()::text);

-- only the owner can publish a slot
drop policy if exists "publish own slot" on public.appointment_slots;
create policy "publish own slot"
  on public.appointment_slots
  for insert
  to authenticated
  with check (owner_id = auth.uid()::text and status = 'open');

-- only the owner can update or delete their own slot
drop policy if exists "manage own slot" on public.appointment_slots;
create policy "manage own slot"
  on public.appointment_slots
  for update
  to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);

drop policy if exists "delete own slot" on public.appointment_slots;
create policy "delete own slot"
  on public.appointment_slots
  for delete
  to authenticated
  using (owner_id = auth.uid()::text);

create index if not exists appointment_slots_open_idx
  on public.appointment_slots (field, status, day);

-- ————— Bookings —————
-- One row per booked call. owner_id is snapshotted at booking so the
-- candidate's view of their own row can carry the (opaque) peer uid for
-- the live-call relay — same uid exposure the `matches` table already has.
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  slot_id           uuid not null references public.appointment_slots(id) on delete cascade,
  owner_id          text not null,          -- the startup's auth uid (opaque peer id for the candidate)
  candidate_id      text not null,          -- the candidate's auth uid
  candidate_name    text not null,
  candidate_school  text,
  candidate_program text,
  field             text not null,          -- industry snapshot — candidates see only this
  day               date not null,
  time              text not null,
  duration_min      int not null default 30,
  status            text not null default 'upcoming', -- upcoming | done
  created_at        timestamptz not null default now()
);

alter table public.appointments enable row level security;

-- a booking is visible only to its candidate and the slot's owner
drop policy if exists "read own bookings" on public.appointments;
create policy "read own bookings"
  on public.appointments
  for select
  to authenticated
  using (
    candidate_id = auth.uid()::text
    or slot_id in (select id from public.appointment_slots where owner_id = auth.uid()::text)
  );

-- participants can flip status (upcoming → done) after the call
drop policy if exists "update own booking" on public.appointments;
create policy "update own booking"
  on public.appointments
  for update
  to authenticated
  using (
    candidate_id = auth.uid()::text
    or slot_id in (select id from public.appointment_slots where owner_id = auth.uid()::text)
  )
  with check (
    candidate_id = auth.uid()::text
    or slot_id in (select id from public.appointment_slots where owner_id = auth.uid()::text)
  );

create index if not exists appointments_participant_idx
  on public.appointments (candidate_id, status);
create index if not exists appointments_slot_idx
  on public.appointments (slot_id);

-- ————— Book a slot (atomic, race-safe) —————
-- One RPC flips the slot to booked and creates the booking in a single
-- transaction — two candidates can't grab the same slot. Security definer
-- bypasses RLS deliberately; the function itself enforces "signed-in
-- caller" and "slot was still open". This is the only way a booking row
-- can be created.
create or replace function public.book_appointment_slot(
  p_slot_id uuid,
  p_name text,
  p_school text,
  p_program text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.appointment_slots%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  -- optimistic lock: only an open slot can be claimed; concurrent
  -- bookings serialize on the row lock and the second one sees 'booked'
  select * into v_slot
    from public.appointment_slots
   where id = p_slot_id
     and status = 'open'
   for update;
  if v_slot.id is null then
    raise exception 'slot no longer open';
  end if;

  update public.appointment_slots
     set status = 'booked'
   where id = p_slot_id;

  insert into public.appointments (
    slot_id, owner_id, candidate_id, candidate_name, candidate_school,
    candidate_program, field, day, time, duration_min, status
  ) values (
    p_slot_id, v_slot.owner_id, auth.uid()::text, p_name, p_school, p_program,
    v_slot.field, v_slot.day, v_slot.time, v_slot.duration_min, 'upcoming'
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.book_appointment_slot(uuid, text, text, text) to authenticated;

-- ————— Convergence guard —————
-- Re-affirm the intended state so a re-run always converges, no matter
-- what ran before (all policies above are drop-first, so they re-create
-- cleanly). The matching room is auth-gated: RLS stays ON.
alter table public.search_offers enable row level security;
alter table public.matches enable row level security;

-- make sure the tables are in the realtime publication (idempotent via DO)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('search_offers', 'matches', 'appointment_slots', 'appointments')
  ) then
    alter publication supabase_realtime add table public.search_offers;
    alter publication supabase_realtime add table public.matches;
    alter publication supabase_realtime add table public.appointment_slots;
    alter publication supabase_realtime add table public.appointments;
  end if;
end
$$;

drop index if exists search_offers_waiting_idx;
create index if not exists search_offers_waiting_idx
  on public.search_offers (role, status, expires_at);

-- ————— Handy queries (run in the SQL editor) —————
-- select event, count(*) from public.match_events group by 1 order by 2 desc;
-- select role, field, status, count(*) from public.matches group by 1,2,3;
