// ————————————————————————————————————————————————————————————
// Match — matchmaking + live session relay.
//
// Matching is ASYNC: a search persists as an offer row in Supabase
// for up to 5 minutes, so two people don't have to press start at the
// same time. Whoever arrives second claims the waiting offer and a
// `matches` row is created — both sides pick it up when they're online.
// Requires the tables in supabase/schema.sql. If Supabase is
// unreachable, it falls back to a same-device BroadcastChannel.
//
// After matching, all session signals (whiteboard, simulations,
// decisions, WebRTC media) route through one relay keyed by matchId.
// Names and companies are never exchanged before the match.
// ————————————————————————————————————————————————————————————

import { supabase } from './supabase.js'

const SUPABASE_ROOM = 'catalyst-match-v1'
const CH = 'catalyst.match.v1'
const HB_MS = 2000
const SEARCH_MS = 1200
const STALE_MS = 6500
const OFFER_TTL_MS = 5 * 60 * 1000

let channel = null
let me = null            // { id, role, fields, resume }
let peers = new Map()    // id -> { id, role, fields, ts }
let isSearching = false
let searchingField = null
let searchTimer = null
let hbTimer = null
let pruneTimer = null
let matched = null       // { matchId, peer: anon, startAt }
let pendingOffer = null  // legacy protocol: we offered and await acceptance
let offerId = null       // async protocol: our waiting offer row id
let offerSub = null      // realtime subscription on our offer row
let listeners = new Map()

const uid = () => Math.random().toString(36).slice(2, 10)

/* ————— events ————— */

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
  return () => off(event, fn)
}

function off(event, fn) {
  listeners.get(event)?.delete(fn)
}

function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload) } catch { /* keep the loop alive */ }
  })
}

/* ————— transport plumbing ————— */

function ensureChannel() {
  if (channel) return true

  // Cross-device: a shared Supabase Realtime broadcast room.
  try {
    const rt = supabase.channel(SUPABASE_ROOM, { config: { broadcast: { self: false } } })
    rt.on('broadcast', { event: 'msg' }, ({ payload }) => handleMessage(payload))
    rt.subscribe((status) => { if (status === 'SUBSCRIBED') emit('channel-open') })
    channel = {
      label: 'supabase',
      send: (msg) => rt.send({ type: 'broadcast', event: 'msg', payload: msg }),
      close: () => { try { supabase.removeChannel(rt) } catch { /* noop */ } },
    }
    return true
  } catch {
    channel = null // fall through to BroadcastChannel
  }

  if (typeof BroadcastChannel === 'undefined') return false
  const bc = new BroadcastChannel(CH)
  bc.onmessage = (e) => handleMessage(e.data)
  channel = {
    label: 'broadcast',
    send: (msg) => bc.postMessage(msg),
    close: () => { try { bc.close() } catch { /* noop */ } },
  }
  return true
}

function post(msg) {
  channel?.send(msg)
}

/* ————— identity & presence ————— */

function anonFor(role, field) {
  // Candidates share a resume snapshot at match (the startup's first look);
  // employers stay anonymous — the candidate only knows the role.
  if (role === 'employer') return { anonId: me.id, role, field, roleType: 'startup', note: 'Verified startup · hiring now' }
  return {
    anonId: me.id,
    role,
    field,
    roleType: 'Intern',
    note: 'Verified student',
    resume: me.resume || null,
  }
}

function announce() {
  post({ t: 'hb', id: me.id, role: me.role, fields: me.fields, ts: Date.now() })
}

function heartbeat() {
  announce()
  // prune stale peers
  const now = Date.now()
  for (const [id, p] of peers) {
    if (now - p.ts > STALE_MS) {
      peers.delete(id)
      if (matched?.peer?.anonId === id) emit('peer-offline')
    }
  }
  emit('presence', presence())
}

/* ————— matching: legacy simultaneous protocol (no backend) ————— */

function legacyStartSearch(field) {
  cancelSearch()
  matched = null
  isSearching = true
  searchingField = field
  post({ t: 'searching', id: me.id, role: me.role, fields: me.fields, field })
  searchTimer = setInterval(() => {
    if (!isSearching) return
    post({ t: 'searching', id: me.id, role: me.role, fields: me.fields, field: searchingField })
  }, SEARCH_MS)
}

function legacyCancelSearch() {
  if (searchTimer) clearInterval(searchTimer)
  searchTimer = null
}

function cancelSearch() {
  isSearching = false
  searchingField = null
  pendingOffer = null
  legacyCancelSearch()
  // the offer row stays live until it expires — someone may claim it while
  // we're away, and checkPendingMatch() picks it up on our return
  offerId = null
  if (offerSub) {
    try { offerSub.unsubscribe() } catch { /* noop */ }
    offerSub = null
  }
}

function setMatched(matchId, peerAnon, offerField) {
  if (matched) return
  cancelSearch()
  matched = { matchId, peer: peerAnon, field: offerField, startAt: Date.now() }
  emit('match', { ...matched })
}

/* ————— matching: async over Postgres ————— */

async function asyncStartSearch(field) {
  cancelSearch()
  matched = null
  isSearching = true
  searchingField = field

  try {
    const opp = me.role === 'candidate' ? 'employer' : 'candidate'
    // 1. Try to claim an existing waiting offer (anyone who searched in the last 5 min).
    const { data: offers, error } = await supabase
      .from('search_offers')
      .select('*')
      .eq('status', 'waiting')
      .eq('role', opp)
      .contains('fields', [field])
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(5)
    if (offers?.length) {
      for (const offer of offers) {
        if (await claimOffer(offer, field)) return true
      }
    }
    if (error) throw error
    // 2. No one waiting — persist our own offer and watch for it being claimed.
    return await createOffer(field)
  } catch {
    // Supabase tables not ready / offline — fall back to the simultaneous protocol.
    legacyStartSearch(field)
    return true
  }
}

async function claimOffer(offer, field) {
  // Optimistic claim — only succeeds while the offer is still waiting.
  const { data, error } = await supabase
    .from('search_offers')
    .update({ status: 'claimed' })
    .eq('id', offer.id)
    .eq('status', 'waiting')
    .select()
  if (error || !data?.length) return false

  // Persist the match so the other side can pick it up later.
  const { data: matchRow, error: matchErr } = await supabase
    .from('matches')
    .insert({
      a_id: me.id,
      b_id: offer.owner_id,
      a_anon: anonFor(me.role, field),
      b_anon: offer.anon || { anonId: offer.owner_id, role: offer.role, field, roleType: offer.role === 'employer' ? 'startup' : 'Intern', note: 'Verified peer' },
      field,
      status: 'pending',
    })
    .select()
    .single()
  if (matchErr || !matchRow) return false

  await supabase.from('search_offers').update({ status: 'matched', match_id: matchRow.id }).eq('id', offer.id)
  setMatched(matchRow.id, matchRow.b_anon, field)
  return true
}

async function createOffer(field) {
  const { data, error } = await supabase
    .from('search_offers')
    .insert({
      owner_id: me.id,
      role: me.role,
      fields: me.fields.length ? me.fields : [field],
      anon: anonFor(me.role, field),
      status: 'waiting',
      expires_at: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
    })
    .select()
    .single()
  if (error || !data) {
    legacyStartSearch(field)
    return true
  }
  offerId = data.id
  // Watch for our offer being claimed — someone matched us.
  offerSub = supabase
    .channel('offer-' + data.id)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'search_offers', filter: 'id=eq.' + data.id,
    }, async (payload) => {
      const row = payload.new
      if (row.status === 'claimed' || row.status === 'matched') {
        await onOfferClaimed(row)
      }
    })
    .subscribe()
  return true
}

async function onOfferClaimed(offerRow) {
  cancelSearch()
  if (!offerRow.match_id) return
  const { data: m } = await supabase.from('matches').select('*').eq('id', offerRow.match_id).maybeSingle()
  if (!m) return
  const meIsA = m.a_id === me.id
  setMatched(m.id, meIsA ? m.b_anon : m.a_anon, m.field)
}

/** a match made while we were away — fetch and adopt it, if any */
async function checkPendingMatch() {
  if (!me) return null
  try {
    const { data } = await supabase
      .from('matches')
      .select('*')
      .or(`a_id.eq.${me.id},b_id.eq.${me.id}`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
    const m = data?.[0]
    if (!m) return null
    const meIsA = m.a_id === me.id
    setMatched(m.id, meIsA ? m.b_anon : m.a_anon, m.field)
    return m
  } catch {
    return null
  }
}

/* ————— message routing ————— */

function handleMessage(msg) {
  if (!msg || !msg.t || !me) return

  switch (msg.t) {
    case 'hb': {
      if (msg.id === me.id) return
      peers.set(msg.id, { id: msg.id, role: msg.role, fields: msg.fields || [], ts: msg.ts || Date.now() })
      emit('presence', presence())
      break
    }
    case 'bye': {
      peers.delete(msg.id)
      if (matched?.peer?.anonId === msg.id) emit('peer-offline')
      emit('presence', presence())
      break
    }
    case 'searching': {
      if (msg.id === me.id || !isSearching || matched || pendingOffer) return
      if (msg.role === me.role) return // only candidate ↔ employer
      if (!me.fields.includes(msg.field)) return
      const peer = peers.get(msg.id)
      if (!peer) return // wait until we have their hello
      // deterministic tiebreak: the lower id offers, the higher id accepts
      if (me.id > msg.id) return
      pendingOffer = { matchId: uid() }
      post({ t: 'match-offer', to: msg.id, from: me.id, matchId: pendingOffer.matchId, field: msg.field, anon: anonFor(me.role, msg.field) })
      break
    }
    case 'match-offer': {
      if (msg.to !== me.id || !isSearching || matched || pendingOffer) return
      post({ t: 'match-accept', to: msg.from, matchId: msg.matchId, field: msg.field, anon: anonFor(me.role, msg.field) })
      setMatched(msg.matchId, msg.anon, msg.field)
      break
    }
    case 'match-accept': {
      if (msg.to !== me.id || !pendingOffer || pendingOffer.matchId !== msg.matchId) return
      setMatched(msg.matchId, msg.anon, msg.field)
      break
    }
    // ——— post-match relay (routed by matchId) ———
    case 'sim':
      if (matched && msg.to === matched.matchId) emit('remote-sim', msg.sim)
      break
    case 'event':
      if (matched && msg.to === matched.matchId) emit('remote-event', msg.ev)
      break
    case 'stroke':
      if (matched && msg.to === matched.matchId) emit('remote-stroke', msg.stroke)
      break
    case 'stroke-live':
      if (matched && msg.to === matched.matchId) emit('remote-stroke-live', msg.pt)
      break
    case 'clear':
      if (matched && msg.to === matched.matchId) emit('remote-clear')
      break
    case 'wb':
      if (matched && msg.to === matched.matchId) emit('remote-wb', msg.open)
      break
    case 'wb-ack':
      if (matched && msg.to === matched.matchId) emit('remote-wb-ack')
      break
    case 'sim-answer':
      if (matched && msg.to === matched.matchId) emit('remote-sim-answer', msg.answer)
      break
    case 'sim-close':
      if (matched && msg.to === matched.matchId) emit('remote-sim-close', msg.simId)
      break
    case 'event-handled':
      if (matched && msg.to === matched.matchId) emit('remote-event-handled', msg.title)
      break
    case 'end':
      if (matched && msg.to === matched.matchId) emit('remote-end')
      break
    case 'decision':
      if (matched && msg.to === matched.matchId) emit('remote-decision', msg.decision)
      break
    // ——— WebRTC media signaling (routed by matchId) ———
    case 'rtc':
      if (matched && msg.to === matched.matchId) emit('remote-signal', msg.signal)
      break
  }
}

/* ————— public API ————— */

export const Match = {
  /** idempotent — sets identity, starts presence heartbeats */
  init({ role, fields, resume, uid: fixedId }) {
    ensureChannel()
    const nextFields = fields || []
    const same = me && me.role === role && JSON.stringify(me.fields) === JSON.stringify(nextFields)
    me = same ? me : { id: fixedId || uid(), role, fields: nextFields, resume: resume || null }
    if (resume) me.resume = resume
    if (!channel) return this
    announce()
    if (!hbTimer) hbTimer = setInterval(heartbeat, HB_MS)
    if (!pruneTimer) pruneTimer = setInterval(() => emit('presence', presence()), HB_MS)
    return this
  },

  /** begin searching for a blind match in `field`; returns false if unsupported */
  startSearch(field) {
    if (!ensureChannel() || !me) return false
    if (channel?.label === 'supabase') {
      asyncStartSearch(field) // fire-and-forget; emits 'match' when paired
      return true
    }
    legacyStartSearch(field)
    return true
  },

  cancelSearch,

  /** adopt a match that was made while we were away, if any */
  checkPendingMatch,

  /** active broadcast transport: 'supabase' | 'broadcast' | null */
  channelInfo() {
    return channel?.label || null
  },

  /** true while a peer is still heartbeating */
  isPeerOnline() {
    if (!matched?.peer) return false
    const p = peers.get(matched.peer.anonId)
    return !!p && Date.now() - p.ts < STALE_MS
  },

  /** currently live participants, e.g. { role: 'employer', field: 'software', count: 2 } */
  presence() {
    return presence()
  },

  /** our active match, if any */
  matchedInfo() {
    return matched ? { ...matched } : null
  },

  on,

  // ——— relay ———
  sendSim(simId) {
    if (matched) post({ t: 'sim', to: matched.matchId, sim: simId })
  },
  sendEvent(ev) {
    if (matched) post({ t: 'event', to: matched.matchId, ev })
  },
  sendStroke(stroke) {
    if (matched) post({ t: 'stroke', to: matched.matchId, stroke })
  },
  sendStrokeLive(pt) {
    if (matched) post({ t: 'stroke-live', to: matched.matchId, pt })
  },
  sendClear() {
    if (matched) post({ t: 'clear', to: matched.matchId })
  },
  sendWb(open) {
    if (matched) post({ t: 'wb', to: matched.matchId, open })
  },
  sendWbAck() {
    if (matched) post({ t: 'wb-ack', to: matched.matchId })
  },
  sendSimAnswer(answer) {
    if (matched) post({ t: 'sim-answer', to: matched.matchId, answer })
    emit('local-sim-answer', answer) // local mirror for the session transcript
  },
  sendSimClose(simId) {
    if (matched) post({ t: 'sim-close', to: matched.matchId, simId })
  },
  sendEventHandled(title) {
    if (matched) post({ t: 'event-handled', to: matched.matchId, title })
  },
  sendEnd() {
    if (matched) post({ t: 'end', to: matched.matchId })
  },
  sendDecision(d) {
    if (matched) post({ t: 'decision', to: matched.matchId, decision: d })
  },
  /** WebRTC offer/answer/ICE — the peer pair negotiates media over the same relay */
  sendSignal(signal) {
    if (matched) post({ t: 'rtc', to: matched.matchId, signal })
  },
  /** deterministic offerer (lower id) so exactly one side initiates WebRTC */
  amOfferer() {
    if (!matched) return false
    return me.id < matched.peer.anonId
  },

  /** full reset (logout / fresh start) */
  dispose() {
    if (me) post({ t: 'bye', id: me.id })
    cancelSearch()
    pendingOffer = null
    if (hbTimer) clearInterval(hbTimer)
    if (pruneTimer) clearInterval(pruneTimer)
    hbTimer = pruneTimer = null
    try { channel?.close() } catch { /* noop */ }
    channel = null
    me = null
    peers.clear()
    matched = null
    listeners.clear()
  },
}

function presence() {
  const out = []
  const byField = new Map()
  for (const p of peers.values()) {
    for (const f of p.fields) {
      const k = `${p.role}:${f}`
      byField.set(k, (byField.get(k) || 0) + 1)
    }
  }
  for (const [k, count] of byField) {
    const [role, field] = k.split(':')
    out.push({ role, field, count })
  }
  return out
}

if (typeof window !== 'undefined') {
  window.__catalystMatch = Match // handy for demos & debugging
}
