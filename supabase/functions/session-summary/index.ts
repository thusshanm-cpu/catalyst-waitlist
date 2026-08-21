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
// ————————————————————————————————————————————————————————————

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const LLM_API_KEY = Deno.env.get('LLM_API_KEY') || ''
const LLM_MODEL = Deno.env.get('LLM_MODEL') || 'gpt-4o-mini'
const LLM_BASE = Deno.env.get('LLM_BASE') || 'https://api.openai.com/v1'

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
  try {
    const { events = [], role = '', field = '' } = await req.json()
    if (!LLM_API_KEY) {
      return new Response(JSON.stringify({ error: 'LLM_API_KEY secret not set' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

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
