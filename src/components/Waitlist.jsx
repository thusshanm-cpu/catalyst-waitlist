import { useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { FIELDS } from '../data.js'
import { joinWaitlist, validEmail } from '../waitlist.js'
import { markJoined } from '../preview.js'
import { Check, Send, GraduationCap, Building, Handshake, ArrowUpRight } from './icons.jsx'

const ROLE_COPY = {
  candidate: {
    seg: "I'm a student",
    fieldsLabel: 'What do you want to interview in?',
    success: "We'll email you the moment your cohort opens.",
  },
  employer: {
    seg: "I'm a startup",
    fieldsLabel: 'What are you hiring for?',
    success: "We'll email you when hiring rooms open in your stack.",
  },
  founder: {
    seg: "I'm a founder",
    fieldsLabel: 'What kind of cofounder are you looking for?',
    success: "We'll email you when cofounder matching opens.",
  },
}

const ROLE_ICONS = {
  candidate: GraduationCap,
  employer: Building,
  founder: Handshake,
}

export default function Waitlist({ initialRole = 'candidate' }) {
  const { api } = useStore()
  const { toast } = useToast()
  const [role, setRole] = useState(initialRole)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [fields, setFields] = useState([])
  const [status, setStatus] = useState('idle') // idle | sending | done | exists
  const [position, setPosition] = useState(0)
  const [error, setError] = useState('')

  const copy = ROLE_COPY[role]

  const toggleField = (id) =>
    setFields((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const submit = async (e) => {
    e.preventDefault()
    if (!validEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setStatus('sending')
    const res = await joinWaitlist({ email, name: name.trim(), role, fields })
    if (res.ok) {
      setPosition(res.position)
      setStatus('done')
      markJoined() // unlock the demo on this device
      toast(`You're #${res.position} on the list`, '✓')
    } else if (res.reason === 'exists') {
      setPosition(res.position)
      setStatus('exists')
      markJoined()
    } else {
      setStatus('idle')
      setError("Something went wrong — please try again.")
    }
  }

  if (status === 'done' || status === 'exists') {
    const already = status === 'exists'
    return (
      <div className="wl-card wl-success" role="status">
        <div className="wl-check"><Check size={24} /></div>
        <h4>{already ? "You're already on the list." : "You're on the list."}</h4>
        <p className="wl-pos">Position <b>#{position}</b></p>
        <p className="wl-note">{copy.success}</p>
        {already && <p className="wl-note">No need to rejoin — we already have your email.</p>}
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => api.navigate('onboarding')}>
          You&apos;re in — try the demo <ArrowUpRight size={15} />
        </button>
        <p className="wl-note" style={{ marginTop: 8 }}>A ten-minute blind session with a real match — no install, no account.</p>
      </div>
    )
  }

  return (
    <div className="wl-card">
      <div className="wl-seg" role="group" aria-label="Who are you?">
        {['candidate', 'employer', 'founder'].map((r) => {
          const Icon = ROLE_ICONS[r]
          return (
            <button
              key={r}
              type="button"
              className={role === r ? 'on' : ''}
              aria-pressed={role === r}
              onClick={() => setRole(r)}
            >
              <Icon size={17} />
              {ROLE_COPY[r].seg}
            </button>
          )
        })}
      </div>

      <form className="wl-form" onSubmit={submit} noValidate>
        <div className="form-row">
          <div className="form-item">
            <label htmlFor="wl-email">Email</label>
            <input
              id="wl-email"
              className="input"
              type="email"
              placeholder="you@school.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-item">
            <label htmlFor="wl-name">Name <span className="opt">· optional</span></label>
            <input
              id="wl-name"
              className="input"
              type="text"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
        </div>

        <div className="form-item">
          <label>{copy.fieldsLabel} <span className="opt">· optional</span></label>
          <div className="wl-fields">
            {FIELDS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip ${fields.includes(f.id) ? 'on' : ''}`}
                aria-pressed={fields.includes(f.id)}
                onClick={() => toggleField(f.id)}
              >
                <span className="dot" />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="wl-error">{error}</p>}

        <button className="btn btn-primary btn-lg" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Joining…' : 'Join the waitlist'}
          {status !== 'sending' && <Send size={16} />}
        </button>
        <p className="wl-note">No spam. One email when you&apos;re off the list.</p>
      </form>
    </div>
  )
}
