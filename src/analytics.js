// ————————————————————————————————————————————————————————————
// Analytics — the funnel, made visible.
//
// Logs match → call → decision events to a `match_events` table in
// Supabase. The publishable key can insert once the table exists with
// RLS allowing anonymous inserts — one-time setup in the Supabase SQL
// editor, see `supabase/schema.sql`. Until then this fails silently
// and the site keeps working.
// ————————————————————————————————————————————————————————————

import { supabase } from './supabase.js'

let warned = false

/**
 * Record one funnel event. Fire-and-forget — never blocks or throws.
 * @param {string} event e.g. 'match_started' | 'call_connected' | 'session_ended'
 * @param {object} [props] role, field, decision, mode, ...
 */
export function track(event, props = {}) {
  const row = { event, ...props, at: new Date().toISOString() }
  supabase
    .from('match_events')
    .insert(row)
    .then(({ error }) => {
      if (error && !warned) {
        warned = true
        console.warn('[analytics] match_events table not ready — run supabase/schema.sql once:', error.message)
      }
    })
    .catch(() => {})
}
