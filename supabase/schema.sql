-- ————————————————————————————————————————————————————————————
-- Catalyst analytics — one-time setup (run once in Supabase →
-- SQL Editor, ~10 seconds). Creates the `match_events` table the
-- client logs funnel events to. Anonymous clients (the publishable
-- key) may only INSERT — they can never read anyone's data.
-- ————————————————————————————————————————————————————————————

create table if not exists public.match_events (
  id       bigint generated always as identity primary key,
  event    text not null,          -- match_started | call_connected | call_failed | peer_left | session_ended | decision
  role     text,                   -- candidate | employer | founder
  field    text,                   -- software | marketing | ...
  mode     text,                   -- real | demo
  decision text,                   -- for session_ended / decision rows
  at       timestamptz not null default now()
);

alter table public.match_events enable row level security;

-- The browser client may write funnel events but never read them.
create policy "anon can insert match events"
  on public.match_events
  for insert
  to anon
  with check (true);

-- Optional: a quick look yourself (run in the SQL editor).
-- select event, count(*) from public.match_events group by 1 order by 2 desc;
