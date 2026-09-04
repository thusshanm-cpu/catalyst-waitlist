// ————————————————————————————————————————————————————————————
// Appointments — booked calls between startups and candidates.
//
// Startups publish open call slots by industry; candidates book them
// and the call runs on the live-session interface. Privacy by
// construction:
//   · a slot row carries NO company identity — candidates only ever see
//     the industry (field), day/time and duration, even via the API.
//   · the booking snapshots the candidate's name/school/program, which
//     is all the startup sees before the call.
//
// Persistence is Supabase-first (`appointment_slots` + `appointments`,
// see supabase/schema.sql). Booking goes through one atomic RPC
// (`book_appointment_slot`) so two candidates can't grab the same slot.
// If the tables aren't set up yet it falls back to localStorage +
// BroadcastChannel so the whole loop still demos on one device (mirrors
// match.js's fallback). Cross-device needs the schema + signed-in users.
// ————————————————————————————————————————————————————————————

import { supabase } from './supabase.js'
import { Match } from './match.js'

const LS_KEY = 'catalyst.appointments.v1'
const BC_CH = 'catalyst.appointments.v1'

let remote = null        // null = unknown · true = supabase tables live · false = local-only
let listeners = new Set()
let bc = null
let store = null

/* ————— local fallback store ————— */

function loadLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    return parsed && Array.isArray(parsed.slots) && Array.isArray(parsed.appointments)
      ? parsed
      : { slots: [], appointments: [] }
  } catch {
    return { slots: [], appointments: [] }
  }
}

function emit() {
  listeners.forEach((fn) => { try { fn() } catch { /* keep the loop alive */ } })
}

function persist(broadcast = true) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)) } catch { /* private mode */ }
  if (broadcast) bc?.postMessage({ t: 'update' })
  emit()
}

function ensureBC() {
  if (bc || typeof BroadcastChannel === 'undefined') return
  bc = new BroadcastChannel(BC_CH)
  bc.onmessage = (e) => {
    if (e.data?.t === 'update') {
      store = loadLocal()
      emit()
    }
  }
}

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)

/* stable per-origin id — "my slots" filtering survives a reload */
function deviceId() {
  let id = null
  try { id = localStorage.getItem('catalyst.device.id') } catch { /* noop */ }
  if (!id) {
    id = uid()
    try { localStorage.setItem('catalyst.device.id', id) } catch { /* noop */ }
  }
  return id
}

async function authId() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id || null
}

/* cheap probe — do the tables exist? (cached) */
async function tablesReady() {
  const { error } = await supabase.from('appointment_slots').select('id').limit(1)
  return !error
}

/* ————— slots (employers publish) ————— */

export async function createSlot({ field, day, time, durationMin }) {
  if (remote !== false) {
    const owner = await authId()
    if (owner) {
      const { data, error } = await supabase
        .from('appointment_slots')
        .insert({ owner_id: owner, field, day, time, duration_min: durationMin, status: 'open' })
        .select()
        .single()
      if (!error && data) {
        remote = true
        attachLive()
        emit()
        return data
      }
    }
    remote = false
  }
  ensureBC()
  if (!store) store = loadLocal()
  const slot = {
    id: 'l' + uid(),
    owner_id: deviceId(),
    owner_match_id: Match.meId(), // the tab's live-relay id, for the candidate's peer presence
    field, day, time,
    duration_min: durationMin,
    status: 'open',
    created_at: new Date().toISOString(),
  }
  store.slots.push(slot)
  persist()
  return slot
}

export async function mySlots() {
  const owner = await authId()
  if (remote !== false && owner) {
    const { data, error } = await supabase
      .from('appointment_slots')
      .select('*')
      .eq('owner_id', owner)
      .order('day', { ascending: true })
      .order('time', { ascending: true })
    if (!error && data) { remote = true; attachLive(); return data }
    remote = false
  }
  if (!store) store = loadLocal()
  const me = deviceId()
  return store.slots.filter((s) => s.owner_id === me)
}

export async function deleteSlot(slotId) {
  if (remote !== false) {
    const { error } = await supabase.from('appointment_slots').delete().eq('id', slotId)
    if (!error) { remote = true; attachLive(); emit(); return }
    remote = false
  }
  if (!store) store = loadLocal()
  store.slots = store.slots.filter((s) => s.id !== slotId)
  store.appointments = store.appointments.filter((a) => a.slot_id !== slotId)
  persist()
}

/* ————— candidates: browse open slots ————— */

export async function openSlots(fields = []) {
  const auth = await authId()
  if (remote !== false && auth) {
    const { data, error } = await supabase
      .from('appointment_slots')
      .select('*')
      .eq('status', 'open')
      .in('field', fields.length ? fields : ['software'])
      .order('day', { ascending: true })
      .order('time', { ascending: true })
      .limit(50)
    if (!error && data) { remote = true; attachLive(); return data }
    remote = false
  }
  if (!store) store = loadLocal()
  return store.slots.filter(
    (s) => s.status === 'open' && (!fields.length || fields.includes(s.field))
  )
}

/* ————— bookings ————— */

export async function bookSlot(slotId, { name, school, program } = {}) {
  const auth = await authId()
  if (remote !== false && auth) {
    const { data, error } = await supabase.rpc('book_appointment_slot', {
      p_slot_id: slotId,
      p_name: name || 'Verified candidate',
      p_school: school || '',
      p_program: program || '',
    })
    if (!error && data) {
      remote = true
      attachLive()
      emit()
      return { id: data, slot_id: slotId }
    }
    // signed in + tables exist → the RPC refused for a real reason
    // (slot just taken), surface it — no silent local fallback
    if (await tablesReady()) throw new Error(error?.message || 'Could not book that slot')
    remote = false
  }
  if (!store) store = loadLocal()
  const slot = store.slots.find((s) => s.id === slotId && s.status === 'open')
  if (!slot) throw new Error('This slot was just taken — pick another time.')
  slot.status = 'booked'
  const appt = {
    id: 'l' + uid(),
    slot_id: slot.id,
    owner_id: slot.owner_id,
    owner_match_id: slot.owner_match_id || slot.owner_id,
    candidate_id: deviceId(),
    candidate_match_id: Match.meId(),
    candidate_name: name || 'Verified candidate',
    candidate_school: school || '',
    candidate_program: program || '',
    field: slot.field,
    day: slot.day,
    time: slot.time,
    duration_min: slot.duration_min,
    status: 'upcoming',
    created_at: new Date().toISOString(),
  }
  store.appointments.push(appt)
  persist()
  return appt
}

export async function myAppointments() {
  const auth = await authId()
  if (remote !== false && auth) {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('day', { ascending: true })
      .order('time', { ascending: true })
    if (!error && data) { remote = true; attachLive(); return data }
    remote = false
  }
  if (!store) store = loadLocal()
  return store.appointments
}

export async function markDone(appointmentId) {
  if (remote !== false) {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'done' })
      .eq('id', appointmentId)
    if (!error) { remote = true; attachLive(); emit(); return }
    remote = false
  }
  if (!store) store = loadLocal()
  const a = store.appointments.find((x) => x.id === appointmentId)
  if (a) { a.status = 'done'; persist() }
}

/* local-mode reload fix: stamp my current relay id into the booking */
export function syncMatchId(appointmentId, role) {
  if (remote === true) return
  if (!store) store = loadLocal()
  const a = store.appointments.find((x) => x.id === appointmentId)
  if (!a) return
  if (role === 'candidate') a.candidate_match_id = Match.meId()
  else a.owner_match_id = Match.meId()
  persist()
}

/* ————— live updates ————— */

let liveCh = null

/* realtime is attached lazily — only after a remote op proves the tables
 * exist (avoids a noisy 404 when the schema hasn't been run yet) */
function attachLive() {
  if (liveCh || remote !== true) return
  liveCh = supabase
    .channel('appointments-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_slots' }, () => emit())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => emit())
    .subscribe()
}

export function subscribe(cb) {
  listeners.add(cb)
  ensureBC()
  if (typeof window === 'undefined') return () => listeners.delete(cb)
  const onStorage = (e) => {
    if (e.key === LS_KEY) { store = loadLocal(); emit() }
  }
  window.addEventListener('storage', onStorage)
  attachLive()
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}