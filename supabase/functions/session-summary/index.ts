// ————————————————————————————————————————————————————————————
// session-summary — real AI session summaries.
//
// Deploy to Supabase (Functions), set the LLM_API_KEY secret, and the
// client's "Analyze my session" button gets a real LLM summary built
// from the actual session transcript.
//
//   supabase functions deploy session-summary
//   supabase secrets set LLM_API_KEY=sk-...
//
// Compatible with any OpenAI-style chat API: set LLM_BASE (e.g. an
// Anthropic/OpenRouter/LocalAI gateway) and LLM_MODEL as needed.
//
// ── Security (this function burns *your* LLM credits, so it is
//    rate-limited server-side) ──────────────────────────────────
//   · verify_jwt stays OFF so the joined-demo flow can use it, but
//     every request must pass a per-IP window limit and a global
//     daily cap, both enforced against the `function_usage` table
//     via the service-role key (never exposed to clients).
//   · Payload guards: content-length and event-count caps reject
//     oversized requests before they reach the LLM.
//   · See supabase/schema.sql — `function_usage` has RLS on with
//     NO policies, so only the edge function (service role) can
//     touch it; clients get permission denied.
// ————————————————————————————————————————————————————————————

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LLM_API_KEY = Deno.env.get('LLM_API_KEY') || ''
const LLM_MODEL = Deno.env.get('LLM_MODEL') || 'gpt-4o-mini'
const LLM_BASE = Deno.env.get('LLM_BASE') || 'https://api.openai.com/v1'

// Rate-limit knobs.
const IP_WINDOW_MIN = 10 // count requests per IP over this window…
const IP_LIMIT = 20 // …and reject beyond this many
const DAILY_CAP = Number(Deno.env.get('LLM_DAILY_CAP') || 5000) // global per-day budget
const MAX_BODY_BYTES = 250_000 // content-length cap
const MAX_EVENTS = 300 // transcript event cap

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM = `You write Catalyst session summaries: short, honest, evidence-based feedback for a
blind job interview that used live startup simulations. You never saw the person's name or
company — evaluate only what happened in the session.

Return STRICT JSON with exactly this shape:
{
  "headline": "one-sentence summary of the session (under 180 chars)",
  "strengths": ["3-5 short concrete strengths, tied to specific events"],
  "growth": ["2-3 short areas to sharpen, tied to specific events"],
  "dims": [
    { "k": "Communication", "v": 0-100 },
    { "k": "Adaptability", "v": 0-100 },
    { "k": "Problem-solving", "v": 0-100 }
  ]
}
Be candid but constructive. If the transcript is empty or too thin to judge, say so honestly
in the headline and give balanced defaults.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Payload guards (cheap rejections before any LLM spend) ──
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'payload too large' }), {
      status: 413,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  const { events = [], role = '', field = '' } = body
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    return new Response(JSON.stringify({ error: 'events must be an array of at most ' + MAX_EVENTS }), {
      status: 413,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!LLM_API_KEY) {
    return new Response(JSON.stringify({ error: 'LLM_API_KEY secret not set' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Rate limiting (per-IP window + global daily cap) ──
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  const now = Date.now()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  try {
    const { count: recent } = await supabase
      .from('function_usage')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gt('called_at', new Date(now - IP_WINDOW_MIN * 60_000).toISOString())
    if ((recent ?? 0) >= IP_LIMIT) {
      return new Response(JSON.stringify({ error: 'too many requests — try again later' }), {
        status: 429,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { count: today } = await supabase
      .from('function_usage')
      .select('id', { count: 'exact', head: true })
      .gt('called_at', new Date(now - 86_400_000).toISOString())
    if ((today ?? 0) >= DAILY_CAP) {
      return new Response(JSON.stringify({ error: 'daily capacity reached — try again tomorrow' }), {
        status: 429,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Reserve a slot, then opportunistically prune old rows (~5% of calls).
    await supabase.from('function_usage').insert({ ip, tag: 'session-summary' })
    if (Math.random() < 0.05) {
      await supabase
        .from('function_usage')
        .delete()
        .lt('called_at', new Date(now - 172_800_000).toISOString())
    }
  } catch {
    // DB unreachable → let it through rather than breaking the demo; the
    // payload guards above still bound the damage.
  }

  // ── LLM call ──
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({ role, field, events }),
          },
        ],
      }),
    })

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) throw new Error(data?.error?.message || 'no completion')

    // extract the JSON object from the model output (some models wrap it)
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    const parsed = json ? JSON.parse(json) : {}
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})