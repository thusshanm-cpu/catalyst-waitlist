import { useState } from 'react'
import { useToast } from '../toast.jsx'
import { FIELDS } from '../data.js'
import { joinWaitlist, validEmail } from '../waitlist.js'
import { Check, Send, GraduationCap, Building } from './icons.jsx'

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
}

export default function Waitlist() {
  const { toast } = useToast()
  const [role, setRole] = useState('candidate')
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
      toast(`You're #${res.position} on the list`, '✓')
    } else if (res.reason === 'exists') {
      setPosition(res.position)
      setStatus('exists')
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
      </div>
    )
  }

  return (
    <div className="wl-card">
      <div className="wl-seg" role="group" aria-label="Who are you?">
        {['candidate', 'employer'].map((r) => (
          <button
            key={r}
            type="button"
            className={role === r ? 'on' : ''}
            aria-pressed={role === r}
            onClick={() => setRole(r)}
          >
            {r === 'candidate' ? <GraduationCap size={17} /> : <Building size={17} />}
            {ROLE_COPY[r].seg}
          </button>
        ))}
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
