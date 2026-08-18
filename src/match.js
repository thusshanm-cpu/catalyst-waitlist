// ————————————————————————————————————————————————————————————
// Match — matchmaking + live session relay.
//
// Two transports, one API:
//   • BroadcastChannel — tabs on the same origin find and join each
//     other (radar matchmaking + presence) with no backend.
//   • PeerJS (WebRTC data channel) — two devices on different networks
//     connect with a short room code, then run the exact same live
//     session (simulations, curveballs, whiteboard strokes, decisions).
//
// Names and companies are never exchanged — that's the point.
// ————————————————————————————————————————————————————————————

const CH = 'catalyst.match.v1'
const HB_MS = 2000
const SEARCH_MS = 1200
const STALE_MS = 6500
const REMOTE_PREFIX = 'catalyst-'
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

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

// remote (two-device) state
let remoteMode = null    // 'host' | 'guest' | null
let remotePeer = null    // PeerJS Peer
let remoteConn = null    // PeerJS DataConnection
let remoteCode = null
let remoteField = null

const uid = () => Math.random().toString(36).slice(2, 10)
const roomCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

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
  if (typeof BroadcastChannel === 'undefined') return false
  channel = new BroadcastChannel(CH)
  channel.onmessage = (e) => handleMessage(e.data)
  return true
}

/* Route to the data channel when a remote peer is live, else broadcast. */
function post(msg) {
  if (remoteConn && remoteConn.open) {
    remoteConn.send(msg)
  } else {
    channel?.postMessage(msg)
  }
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

/* ————— matching protocol (broadcast transport) ————— */

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

/* ————— remote (two-device) protocol ————— */

async function loadPeerjs() {
  const mod = await import('peerjs')
  return mod.Peer
}

async function hostRemote(field) {
  if (!me) throw new Error('not-ready')
  if (remoteMode === 'host' && remotePeer) return remoteCode
  if (remoteMode) return null

  const Peer = await loadPeerjs()
  remoteMode = 'host'
  remoteField = field
  remoteCode = roomCode()
  remotePeer = new Peer(REMOTE_PREFIX + remoteCode)

  return new Promise((resolve, reject) => {
    remotePeer.on('open', () => resolve(remoteCode))
    remotePeer.on('error', (err) => { cleanupRemote(); reject(err) })
    remotePeer.on('connection', (conn) => {
      remoteConn = conn
      const matchId = uid()
      conn.on('open', () => {
        post({ t: 'remote-hello', matchId, anon: anonFor(me.role, remoteField), field: remoteField, ack: false })
      })
      conn.on('data', (d) => handleMessage(d))
      conn.on('close', () => emit('peer-offline'))
      conn.on('error', () => emit('peer-offline'))
    })
  })
}

async function joinRemote(code, field) {
  if (!me) throw new Error('not-ready')
  if (remoteMode) return remoteState()

  const clean = String(code || '').trim().toUpperCase()
  if (!clean) throw new Error('bad-code')

  const Peer = await loadPeerjs()
  remoteMode = 'guest'
  remoteField = field
  remoteCode = clean
  remotePeer = new Peer()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanupRemote(); reject(new Error('timeout')) }, 20000)
    remotePeer.on('open', () => {
      const conn = remotePeer.connect(REMOTE_PREFIX + clean, { reliable: true })
      remoteConn = conn
      conn.on('open', () => { clearTimeout(timer); resolve(remoteState()) })
      conn.on('data', (d) => handleMessage(d))
      conn.on('close', () => { clearTimeout(timer); emit('peer-offline') })
      conn.on('error', () => { clearTimeout(timer); cleanupRemote(); reject(new Error('connect')) })
    })
    remotePeer.on('error', (err) => { clearTimeout(timer); cleanupRemote(); reject(err) })
  })
}

function leaveRemote() {
  if (!remoteMode) return
  if (remoteConn?.open && matched) remoteConn.send({ t: 'end', to: matched.matchId })
  cleanupRemote()
  cancelSearch()
  matched = null
}

function cleanupRemote() {
  try { remoteConn?.close() } catch { /* noop */ }
  try { remotePeer?.destroy() } catch { /* noop */ }
  remoteConn = null
  remotePeer = null
  remoteMode = null
  remoteCode = null
  remoteField = null
}

function remoteState() {
  return {
    mode: remoteMode,
    code: remoteCode,
    connected: !!(remoteConn && remoteConn.open),
    matched: !!matched,
  }
}

function handleMessage(msg) {
  if (!msg || !msg.t || !me) return

  // Remote mode only cares about the handshake and match-directed relay.
  if (remoteMode && msg.t !== 'remote-hello' && msg.to !== matched?.matchId) return

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
    case 'remote-hello': {
      if (!remoteMode) break
      if (msg.ack) {
        // guest → host: we have the guest's blind profile now
        if (!matched) setMatched(msg.matchId, msg.anon, msg.field)
      } else {
        // host → guest: accept and send our blind profile back
        if (!matched) {
          setMatched(msg.matchId, msg.anon, msg.field)
          post({ t: 'remote-hello', matchId: msg.matchId, anon: anonFor(me.role, msg.field), field: msg.field, ack: true })
        }
      }
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

  /** host a two-device session; resolves to the room code to share */
  hostRemote(field) {
    return hostRemote(field)
  },

  /** join a two-device session by room code */
  joinRemote(code, field) {
    return joinRemote(code, field)
  },

  /** end the remote link (stops before/after a session) */
  leaveRemote,

  /** { mode, code, connected, matched } for the remote UI */
  remoteState,

  /** true while a peer is still heartbeating (or the data channel is open) */
  isPeerOnline() {
    if (remoteMode) return !!(remoteConn && remoteConn.open)
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

  /** full reset (logout / fresh start) */
  dispose() {
    if (me && !remoteMode) post({ t: 'bye', id: me.id })
    cancelSearch()
    pendingOffer = null
    if (hbTimer) clearInterval(hbTimer)
    if (pruneTimer) clearInterval(pruneTimer)
    hbTimer = pruneTimer = null
    cleanupRemote()
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
