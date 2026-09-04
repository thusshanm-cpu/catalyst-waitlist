# Supabase setup (one-time)

Everything in the app that needs persistence or real accounts runs on this
project: `https://aazquqwcfpbnoouinmhn.supabase.co`.

## 1. Tables + RLS (~20 seconds)

Open **Supabase → SQL Editor** and run the whole file:

```
supabase/schema.sql
```

It creates (idempotently):

| Table | Purpose |
|---|---|
| `profiles` | real account profiles (linked to Supabase Auth users) |
| `search_offers` | async matching — searches persist up to 5 minutes |
| `matches` | a made match, picked up by both sides when online |
| `match_events` | funnel analytics (match → call → decision) |
| `function_usage` | rate-limit counter for the `session-summary` edge fn |
| `appointment_slots` | booked calls — startups publish open slots by industry (no company info on the row) |
| `appointments` | a booked call — startup sees the candidate's name; booking goes through the atomic `book_appointment_slot` RPC |

Safe to re-run: every statement is idempotent (drop-first where it
matters), so pulling the latest `schema.sql` after this hardening change
and running it again just converges.

Until this runs, live matching silently falls back to the old
same-device BroadcastChannel path and analytics no-ops.

## 2. Real AI summaries (Edge Function)

The client calls `session-summary`, which holds the LLM key server-side.
Deploy once with the Supabase CLI (logged in, project linked):

```bash
supabase functions deploy session-summary
supabase secrets set LLM_API_KEY=sk-...            # your LLM provider key
# optional:
# supabase secrets set LLM_MODEL=gpt-4o-mini
# supabase secrets set LLM_BASE=https://api.openai.com/v1
# supabase secrets set LLM_DAILY_CAP=5000          # global per-day request cap
```

Works with any OpenAI-style chat API (OpenAI, OpenRouter, LocalAI, …).
Until this deploys, "Analyze my session" falls back to the local demo
summary with an honest label.

## 3. Accounts (Supabase Auth)

Nothing to set up — Auth works out of the box with the publishable key.
Email confirmation is on by default (a new signup must confirm their
email once). Profiles are written to `profiles` when onboarding completes.

## Notes

- The matching room (`search_offers` / `matches`) is **auth-gated**: RLS
  is on, and only signed-in users can post or claim offers. An offer is
  visible to searchers while `waiting`, then only to its owner and the
  claimer (`claimed_by`). A match row is visible only to its two
  participants. Anonymous/preview users fall back to the legacy
  simultaneous-match path, which stays local to the browser.
- `match_events` is write-only from the client (nobody can read it) and
  inserts are restricted to **authenticated** users — anonymous visitors
  can't spam junk rows into the funnel. Verification is still manual
  (you flip `profiles.verification_status` to `approved`).
- **Booked calls** are auth-gated like the matching room: only signed-in
  users can publish slots or book them (the `book_appointment_slot` RPC
  enforces this server-side and makes double-booking impossible). Slots
  deliberately carry no company identity, so a candidate can never read
  the startup's name — even via the API. The startup sees the candidate's
  name/school/program from the booking.
- `session-summary` is deliberately open to the joined demo (no JWT), so
  it rate-limits itself: per-IP window (20 req / 10 min) plus a global
  daily cap (`LLM_DAILY_CAP`, default 5,000), tracked in `function_usage`
  via the service-role key. Oversized payloads are rejected before they
  reach the LLM.
- Real biometric KYC (government ID + face match) needs a vendor
  (Stripe Identity, Persona, …). `profiles.verification_status` is the
  state machine waiting for it.
