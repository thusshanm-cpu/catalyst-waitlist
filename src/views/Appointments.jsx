import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { Match } from '../match.js'
import { track } from '../analytics.js'
import * as Appt from '../appointments.js'
import { fieldLabel } from '../data.js'
import { Calendar, Building, GraduationCap } from '../components/icons.jsx'

const DAY_OPTS = (() => {
  const out = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ iso, label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) })
  }
  return out
})()

const TIME_OPTS = (() => {
  const out = []
  for (let h = 9; h <= 18; h++) {
    for (const m of [0, 30]) {
      if (h === 18 && m > 0) continue
      const hh = h % 12 === 0 ? 12 : h % 12
      out.push(`${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`)
    }
  }
  return out
})()

const fmtDay = (iso) => {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function Appointments() {
  const { state, api } = useStore()
  const { toast } = useToast()
  const user = state.user
  const isCandidate = user?.role === 'candidate'
  const fields = useMemo(() => (user?.fields?.length ? user.fields : ['software']), [user?.fields])

  const [slots, setSlots] = useState([])
  const [appts, setAppts] = useState([])
  const [form, setForm] = useState({ field: fields[0], day: DAY_OPTS[0].iso, time: '2:00 PM', durationMin: 30 })
  const [busy, setBusy] = useState(null)

  const refresh = useCallback(async () => {
    const [s, a] = await Promise.all([isCandidate ? Appt.openSlots(fields) : Appt.mySlots(), Appt.myAppointments()])
    setSlots(s || [])
    setAppts(a || [])
  }, [isCandidate, fields])

  useEffect(() => {
    const off = Appt.subscribe(refresh)
    refresh()
    const iv = setInterval(refresh, 5000)
    return () => { off(); clearInterval(iv) }
  }, [refresh])

  const publish = async () => {
    if (busy) return
    if (!form.field || !form.day || !form.time) { toast('Pick an industry, a day, and a time first', '·'); return }
    setBusy('publish')
    try {
      await Appt.createSlot({ field: form.field, day: form.day, time: form.time, durationMin: form.durationMin })
      track('appointment_created', { role: 'employer', field: form.field })
      toast('Slot published — candidates see the industry only', '📅')
    } catch (e) {
      toast(e?.message || 'Could not publish the slot', '⚠️')
    }
    setBusy(null)
    refresh()
  }

  const removeSlot = async (id) => {
    if (busy) return
    setBusy('rm-' + id)
    await Appt.deleteSlot(id)
    setBusy(null)
    toast('Slot removed', '·')
    refresh()
  }

  const book = async (slot) => {
    if (busy) return
    setBusy('book-' + slot.id)
    try {
      await Appt.bookSlot(slot.id, { name: user?.name || 'Verified candidate', school: user?.school || '', program: user?.program || '' })
      track('appointment_booked', { role: 'candidate', field: slot.field })
      toast('Booked — they see your name, you see only the industry', '📅')
    } catch (e) {
      toast(e?.message || 'Could not book that slot', '⚠️')
    }
    setBusy(null)
    refresh()
  }

  const join = (a) => {
    if (busy) return
    setBusy('join-' + a.id)
    Appt.syncMatchId(a.id, isCandidate ? 'candidate' : 'employer')
    const field = a.field
    const peerAnon = isCandidate
      ? { anonId: a.owner_match_id || a.owner_id, role: 'employer', field, roleType: 'startup', note: 'Verified startup · hiring now' }
      : { anonId: a.candidate_match_id || a.candidate_id, role: 'candidate', field, roleType: 'Intern', note: 'Verified student' }
    const real = import.meta.env.DEV
    const counterpart = isCandidate
      ? { anon: true, name: 'Verified startup', title: `Hiring ${fieldLabel(field)} · Intern`, org: '', you: 'Candidate' }
      : { anon: true, name: a.candidate_name || 'Verified student', title: [a.candidate_program, a.candidate_school].filter(Boolean).join(' · ') || 'Verified student', org: '', you: 'Employer' }
    Match.joinAppointment({ matchId: a.id, peerAnon, field })
    api.startSession({
      id: a.id,
      phase: 'connecting',
      mode: 'appt',
      role: fieldLabel(field),
      roleType: 'Intern',
      field,
      anonId: peerAnon.anonId,
      duration: real ? (a.duration_min || 30) * 60 : 90,
      introSecs: real ? 60 : 15,
      perspective: isCandidate ? 'candidate' : 'employer',
      counterpart,
      appointmentId: a.id,
      simulation: null,
      events: [],
      consent: { recording: false, ai: false },
      choices: {},
      transcript: [],
    })
    track('appointment_joined', { role: isCandidate ? 'candidate' : 'employer', field })
  }

  return (
    <div className="appt-panel">
      <div className="dash-head">
        <div>
          <h1>{isCandidate ? 'Book a call with a startup' : 'Offer call slots'}</h1>
          <div className="sub">
            {isCandidate
              ? 'Startups publish open slots by industry. You book blind — you see the industry, they see your name.'
              : 'Publish open slots in your hiring fields. Candidates book blind — they see the industry, you see who is coming.'}
          </div>
        </div>
      </div>

      <div className="appt-grid">
        <div>
          {isCandidate ? (
            <>
              <h3 className="appt-h">Open slots · {fields.map(fieldLabel).join(', ')}</h3>
              <div className="appt-list">
                {slots.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 20px' }}>
                    <span className="empty-ic"><Calendar size={17} /></span>
                    <strong>No open slots right now</strong>
                    <span>Startups publish call slots here — check back soon.</span>
                  </div>
                ) : slots.map((s) => (
                  <div key={s.id} className="queue-item appt-slot">
                    <span className="q-icon"><Calendar size={18} /></span>
                    <span style={{ flex: 1 }}>
                      <span className="q-title">{fieldLabel(s.field)}</span>
                      <span className="q-sub" style={{ display: 'block' }}>{fmtDay(s.day)} · {s.time} · {s.duration_min} min · Verified startup</span>
                    </span>
                    <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => book(s)}>
                      {busy === 'book-' + s.id ? 'Booking…' : 'Book →'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="card card-pad">
              <h3 className="appt-h">Publish a call slot</h3>
              <div className="form-row">
                <div className="form-item">
                  <label>Industry</label>
                  <select className="input" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>
                    {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
                  </select>
                </div>
                <div className="form-item">
                  <label>Duration</label>
                  <select className="input" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
                    {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-item">
                  <label>Day</label>
                  <select className="input" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
                    {DAY_OPTS.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
                  </select>
                </div>
                <div className="form-item">
                  <label>Time</label>
                  <select className="input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}>
                    {TIME_OPTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" disabled={!!busy} onClick={publish}>
                {busy === 'publish' ? 'Publishing…' : 'Publish slot →'}
              </button>
              <p className="appt-hint">The company name is never attached to a slot — candidates see only the industry.</p>
            </div>
          )}

          <h3 className="appt-h" style={{ marginTop: 26 }}>{isCandidate ? 'Your booked calls' : 'Booked calls'}</h3>
          <div className="appt-list">
            {appts.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 20px' }}>
                <span className="empty-ic">{isCandidate ? <Building size={17} /> : <Calendar size={17} />}</span>
                <strong>{isCandidate ? 'Nothing booked yet' : 'No bookings yet'}</strong>
                <span>{isCandidate ? 'Book an open slot above and it lands here.' : 'When a candidate books a slot, it lands here with their name.'}</span>
              </div>
            ) : appts.map((a) => (
              <div key={a.id} className="queue-item appt-slot">
                <span className="q-icon">{isCandidate ? <Building size={18} /> : <GraduationCap size={18} />}</span>
                <span style={{ flex: 1 }}>
                  <span className="q-title">{isCandidate ? fieldLabel(a.field) : a.candidate_name}</span>
                  <span className="q-sub" style={{ display: 'block' }}>
                    {isCandidate
                      ? `${fmtDay(a.day)} · ${a.time} · ${a.duration_min} min · Verified startup (name revealed after the call)`
                      : [a.candidate_program, a.candidate_school].filter(Boolean).join(' · ') || 'Verified student'}
                  </span>
                  {!isCandidate && (
                    <span className="q-sub" style={{ display: 'block' }}>{fmtDay(a.day)} · {a.time} · {fieldLabel(a.field)}</span>
                  )}
                </span>
                <button className={`btn ${a.status === 'done' ? 'btn-ghost' : 'btn-primary'} btn-sm`} disabled={!!busy || a.status === 'done'} onClick={() => join(a)}>
                  {a.status === 'done' ? 'Done ✓' : (busy === 'join-' + a.id ? 'Joining…' : 'Join call →')}
                </button>
              </div>
            ))}
          </div>
        </div>

        {!isCandidate && (
          <div>
            <h3 className="appt-h">Your published slots</h3>
            <div className="appt-list">
              {slots.length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 20px' }}>
                  <span className="empty-ic"><Calendar size={17} /></span>
                  <strong>No slots yet</strong>
                  <span>Publish your first slot to start taking booked calls.</span>
                </div>
              ) : slots.map((s) => {
                const booked = appts.find((a) => a.slot_id === s.id)
                return (
                  <div key={s.id} className="queue-item appt-slot">
                    <span className="q-icon"><Calendar size={18} /></span>
                    <span style={{ flex: 1 }}>
                      <span className="q-title">{fieldLabel(s.field)}</span>
                      <span className="q-sub" style={{ display: 'block' }}>{fmtDay(s.day)} · {s.time} · {s.duration_min} min</span>
                      <span className="q-sub" style={{ display: 'block', color: s.status === 'booked' ? 'var(--amber)' : undefined }}>
                        {s.status === 'booked'
                          ? `Booked by ${booked?.candidate_name || 'a candidate'}${booked?.candidate_school ? ` · ${booked.candidate_school}` : ''}`
                          : 'Open — visible to candidates in this industry'}
                      </span>
                    </span>
                    {s.status === 'open' ? (
                      <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => removeSlot(s.id)}>
                        {busy === 'rm-' + s.id ? '…' : 'Remove'}
                      </button>
                    ) : (
                      <span className="q-meta">BOOKED</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}