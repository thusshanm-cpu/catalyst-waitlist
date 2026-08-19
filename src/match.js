// ————————————————————————————————————————————————————————————
// Match — matchmaking + live session relay.
//
// Two transports, one API:
//   • Supabase Realtime — devices on different networks announce
//     presence and blind-match automatically (no codes, just press start).
//   • BroadcastChannel — tabs on the same origin do the same with no backend.
//
// Names and companies are never exchanged — that's the point.
// ————————————————————————————————————————————————————————————

import { createClient } from '@supabase/supabase-js'

// ——— Supabase Realtime (cross-device automatic matching) ———
// Project URL + publishable key (Dashboard → Project Settings → API).
// These are safe to ship in the client. Leave both empty to use BroadcastChannel.
const SUPABASE_URL = 'https://aazquqwcfpbnoouinmhn.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_8-zmag01KDM6IeJW7DWqJw_VOU8p6oy'
const SUPABASE_ROOM = 'catalyst-match-v1'

const CH = 'catalyst.match.v1'
const HB_MS = 2000
const SEARCH_MS = 1200
const STALE_MS = 6500

let channel = null
let me = null            // { id, role, fields, resume }
let peers = new Map()    // id -> { id, role, fields, ts }
let isSearching = false
let searchingField = null
let searchTimer = null
let hbTimer = null
let pruneTimer = null
let matched = null       // { matchId, peer: anon, startAt }
let pendingOffer = null  // { matchId } we offered and are awaiting acceptance
let listeners = new Map() // event -> Set<fn>

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
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const rt = client.channel(SUPABASE_ROOM, { config: { broadcast: { self: false } } })
      rt.on('broadcast', { event: 'msg' }, ({ payload }) => handleMessage(payload))
      rt.subscribe((status) => { if (status === 'SUBSCRIBED') emit('channel-open') })
      channel = {
        label: 'supabase',
        send: (msg) => rt.send({ type: 'broadcast', event: 'msg', payload: msg }),
        close: () => { try { client.removeChannel(rt) } catch { /* noop */ } },
      }
      return true
    } catch {
      channel = null // fall through to BroadcastChannel
    }
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

/* ————— matching protocol ————— */

function startSearch(field) {
  if (!ensureChannel() || !me) return false
  cancelSearch()
  matched = null // a fresh search starts a fresh match
  isSearching = true
  searchingField = field
  post({ t: 'searching', id: me.id, role: me.role, fields: me.fields, field })
  searchTimer = setInterval(() => {
    if (!isSearching) return
    post({ t: 'searching', id: me.id, role: me.role, fields: me.fields, field: searchingField })
  }, SEARCH_MS)
  return true
}

function cancelSearch() {
  isSearching = false
  searchingField = null
  pendingOffer = null
  if (searchTimer) clearInterval(searchTimer)
  searchTimer = null
}

function setMatched(matchId, peerAnon, offerField) {
  if (matched) return
  cancelSearch()
  matched = { matchId, peer: peerAnon, field: offerField, startAt: Date.now() }
  emit('match', { ...matched })
}

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
  init({ role, fields, resume }) {
    ensureChannel()
    const nextFields = fields || []
    const same = me && me.role === role && JSON.stringify(me.fields) === JSON.stringify(nextFields)
    me = same ? me : { id: uid(), role, fields: nextFields, resume: resume || null }
    if (resume) me.resume = resume
    if (!channel) return this
    announce()
    if (!hbTimer) hbTimer = setInterval(heartbeat, HB_MS)
    if (!pruneTimer) pruneTimer = setInterval(() => emit('presence', presence()), HB_MS)
    return this
  },

  /** begin searching for a blind match in `field`; returns false if unsupported */
  startSearch(field) {
    return startSearch(field)
  },

  cancelSearch,

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
