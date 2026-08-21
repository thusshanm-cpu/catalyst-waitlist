// ————————————————————————————————————————————————————————————
// Real AI session summaries.
//
// Calls the `session-summary` Supabase Edge Function, which holds the
// LLM API key server-side and never ships it to the client. Until that
// function is deployed (see supabase/README), this returns
// { real: false } and the UI falls back to the local demo summary.
// ————————————————————————————————————————————————————————————

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js'

/**
 * @param {{ events: Array, role?: string, field?: string }} input
 * @returns {{ real: true, headline, strengths, growth, dims } | { real: false }}
 */
export async function generateSummary({ events = [], role, field }) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/session-summary`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events, role, field }),
    })
    if (!res.ok) return { real: false }
    const data = await res.json()
    if (!data || !data.headline) return { real: false }
    return {
      real: true,
      headline: data.headline,
      strengths: Array.isArray(data.strengths) ? data.strengths : [],
      growth: Array.isArray(data.growth) ? data.growth : [],
      dims: Array.isArray(data.dims) ? data.dims : [],
    }
  } catch {
    return { real: false }
  }
}
