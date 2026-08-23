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
- The one deliberate tradeoff: `match_events` is insert-only to anon
  (nobody can read it from the client) and verification is still manual
  (you flip `profiles.verification_status` to `approved`).
- Real biometric KYC (government ID + face match) needs a vendor
  (Stripe Identity, Persona, …). `profiles.verification_status` is the
  state machine waiting for it.
