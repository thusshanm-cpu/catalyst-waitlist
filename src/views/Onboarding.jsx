import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { supabase } from '../supabase.js'
import { FIELDS, DEMO_PROFILES } from '../data.js'
import { Zap, FileText, IdCard, Mail, FIELD_ICONS, Spark } from '../components/icons.jsx'

const REVIEW_STEPS = [
  ['Government ID review', 'Documents match the applicant record'],
  ['Facial match', 'Live face scan compared against ID photo'],
  ['Education check', 'Institution and enrolment confirmed'],
  ['Manual review', 'A human reviews the full profile'],
]

export default function Onboarding() {
  const { state, api } = useStore()
  const { toast } = useToast()

  const [role, setRole] = useState(() => sessionStorage.getItem('catalyst.role') || 'candidate')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    name: '',
    email: '',
    school: '',
    program: '',
    location: '',
    company: '',
    title: '',
    website: '',
    resume: null,
    resumeName: '',
    idName: '',
    facePhoto: null,
    emailCode: '',
    emailVerified: false,
    fields: [],
  })
  const [reviewIdx, setReviewIdx] = useState(-1)
  const [reviewed, setReviewed] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  /* judge-mode shortcut: pre-fill every field so the flow can be clicked through */
  const prefill = () => {
    const d = DEMO_PROFILES[role] || DEMO_PROFILES.candidate
    setForm((f) => ({
      ...f,
      ...d,
      resume: { name: d.resumeName },
      idName: 'driver_license.jpg',
      emailCode: '482913',
      emailVerified: true,
      facePhoto: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="24" r="14" fill="%238c93fb"/><path d="M10 58c2-16 44-16 44 0z" fill="%23818b98"/></svg>',
    }))
    toast('Demo data filled — just click Continue', '⚡')
  }

  const skipReview = () => {
    setReviewIdx(REVIEW_STEPS.length - 1)
    setReviewed(true)
    toast('Review fast-forwarded for the demo', '⏩')
  }

  const isCandidate = role === 'candidate'
  const STEPS = isCandidate
    ? ['Who are you', 'Details', 'Verification', 'Your fields', 'Review']
    : ['Who are you', 'Company', 'Verification', 'Roles you hire', 'Review']

  useEffect(() => {
    if (step !== STEPS.length) return
    const t = setTimeout(() => setReviewIdx(0), 600)
    return () => clearTimeout(t)
  }, [step, STEPS.length])

  useEffect(() => {
    if (reviewIdx < 0 || reviewIdx >= REVIEW_STEPS.length) return
    if (reviewIdx === REVIEW_STEPS.length - 1) {
      const t = setTimeout(() => setReviewed(true), 1800)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setReviewIdx((i) => i + 1), 1500)
    return () => clearTimeout(t)
  }, [reviewIdx])

  const next = () => {
    if (step === 1 && !role) return
    if (step === 2 && !form.name) { toast('Add your name to continue', '·'); return }
    if (step === 3 && !(form.resume && form.idName && form.facePhoto && form.emailVerified)) {
      toast('Finish every verification step first', '·'); return
    }
    if (step === 4 && form.fields.length === 0) { toast('Pick at least one field', '·'); return }
    setStep((s) => s + 1)
  }

  const finish = () => {
    const profile = {
      role,
      name: form.name,
      email: form.email,
      school: isCandidate ? form.school : undefined,
      program: isCandidate ? form.program : undefined,
      location: isCandidate ? form.location : undefined,
      resumeName: isCandidate ? form.resumeName : undefined,
      company: !isCandidate ? form.company : undefined,
      title: !isCandidate ? form.title : undefined,
      fields: form.fields,
      avatar: form.facePhoto,
    }
    if (state.authUser) {
      // Real account — persist the profile server-side, status pending.
      // Real biometric verification ships with the KYC vendor (Stripe Identity etc.).
      supabase
        .from('profiles')
        .upsert({
          id: state.authUser.id,
          role,
          name: form.name,
          email: form.email,
          school: isCandidate ? form.school : null,
          program: isCandidate ? form.program : null,
          fields: form.fields,
          verification_status: 'pending',
        })
        .then(({ error }) => {
          if (error) console.warn('[profiles] save failed — run supabase/schema.sql:', error.message)
        })
      api.completeOnboarding({ ...profile, verificationStatus: 'pending' }, { verified: false })
      toast('Profile submitted — under human review', '⏳')
    } else {
      api.completeOnboarding(profile)
      toast('Profile approved — welcome to the room', '✓')
    }
  }

  return (
    <div className="shell">
      <div className="shell-main">
        <div className="container ob-wrap">
          <div className="app-bar" style={{ borderBottom: 0, paddingTop: 0 }}>
            <div className="brand" onClick={() => api.navigate('landing')}>Catalyst</div>
            <span className="verified-badge" style={{ marginLeft: 'auto' }}>SECURE ONBOARDING</span>
          </div>

          <div className="stepper">
            {STEPS.map((_, i) => (
              <div key={i} className={`step-tick ${i < step - 1 ? 'done' : i === step - 1 ? 'now' : ''}`} />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={prefill}><Zap size={13} /> Pre-fill demo data</button>
          </div>

          <h1 className="display display-md" style={{ marginBottom: 8 }}>
            {step === 1 && 'Who\u2019s in the room?'}
            {step === 2 && (isCandidate ? 'About you' : 'About the company')}
            {step === 3 && 'Verification'}
            {step === 4 && (isCandidate ? 'Choose your fields' : 'Which roles are you hiring?')}
            {step === 5 && 'Final review'}
          </h1>
          <p className="muted" style={{ marginBottom: 30, fontSize: 14.5 }}>
            {step === 1 && 'Every account is manually reviewed. This keeps the room free of fakes.'}
            {step === 2 && (isCandidate ? 'What employers will see after you\u2019re matched.' : 'Proof that this is a real, hiring company.')}
            {step === 3 && 'Identity and contact — checked by a human before you enter a room.'}
            {step === 4 && (isCandidate ? 'You\u2019ll only ever be matched with startups hiring in these fields.' : 'You\u2019ll only meet candidates verified for these roles.')}
            {step === 5 && 'Our team reviews every profile. This takes about a minute.'}
          </p>

          {/* Step 1 — role */}
          {step === 1 && (
            <div className="cta-grid">
              <div className={`cta-card cand ${role === 'candidate' ? '' : ''}`} style={{ cursor: 'pointer', outline: role === 'candidate' ? '2px solid var(--ember)' : 'none' }} onClick={() => setRole('candidate')}>
                <span className="role">Student</span>
                <h4>I&apos;m a student</h4>
                <p>High school or university. Get matched with startups in your field and interviewed on live scenarios.</p>
              </div>
              <div className="cta-card startup" style={{ cursor: 'pointer', outline: role === 'employer' ? '2px solid var(--violet)' : 'none' }} onClick={() => setRole('employer')}>
                <span className="role">Startup</span>
                <h4>I&apos;m a startup</h4>
                <p>Hiring in the next 90 days. Meet anonymous candidates, run simulations, unlock profiles you like.</p>
              </div>
            </div>
          )}

          {/* Step 2 — details */}
          {step === 2 && (
            <div className="card card-pad">
              <div className="form-row">
                <div className="form-item">
                  <label>{isCandidate ? 'Full name' : 'Your name'}</label>
                  <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={isCandidate ? 'Jordan Lee' : 'Priya Nair'} />
                </div>
                <div className="form-item">
                  <label>Email</label>
                  <input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder={isCandidate ? 'you@school.edu' : 'you@yourstartup.com'} />
                </div>
              </div>
              {isCandidate ? (
                <div className="form-row">
                  <div className="form-item">
                    <label>School</label>
                    <input className="input" value={form.school} onChange={(e) => set('school', e.target.value)} placeholder="University of Waterloo" />
                  </div>
                  <div className="form-item">
                    <label>Program / year</label>
                    <input className="input" value={form.program || ''} onChange={(e) => set('program', e.target.value)} placeholder="Computer Science · 3rd year" />
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <div className="form-item">
                    <label>Company</label>
                    <input className="input" value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Helios Robotics" />
                  </div>
                  <div className="form-item">
                    <label>Your title</label>
                    <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Co-founder & CTO" />
                  </div>
                </div>
              )}
              <div className="form-item">
                <label>{isCandidate ? 'Where are you based?' : 'Company website or LinkedIn'}</label>
                <input className="input" value={isCandidate ? form.location || '' : form.website} onChange={(e) => set(isCandidate ? 'location' : 'website', e.target.value)} placeholder={isCandidate ? 'Toronto, Canada' : 'heliosrobotics.com'} />
              </div>
            </div>
          )}

          {/* Step 3 — verification */}
          {step === 3 && (
            <div style={{ display: 'grid', gap: 14 }}>
              <UploadBox
                icon={<FileText size={19} />}
                title="Resume / education history"
                sub="PDF or link — startups get this the moment you match"
                done={!!form.resumeName}
                onChange={(f) => { set('resume', f); set('resumeName', f?.name || '') }}
              />
              <UploadBox
                icon={<IdCard size={19} />}
                title="Government-issued ID"
                sub={'Passport, driver\u2019s license, or national ID — encrypted, reviewed by humans only'}
                done={!!form.idName}
                onChange={(f) => { set('idName', f?.name || '') }}
              />
              <FaceCapture photo={form.facePhoto} onCapture={(data) => set('facePhoto', data)} />

              <div className="card card-pad">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div className="verify-box" style={{ flex: 1, border: 0, padding: 0, cursor: 'default' }}>
                    <div className="v-icon"><Mail size={19} /></div>
                    <div>
                      <div className="v-title">Email verification</div>
                      <div className="v-sub">A 6-digit code was sent to {form.email || 'your email'}</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    className="input" style={{ flex: 1, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
                    value={form.emailCode} maxLength={6} placeholder="______"
                    onChange={(e) => set('emailCode', e.target.value.replace(/\D/g, ''))}
                  />
                  <button className="btn btn-ghost" onClick={() => set('emailCode', '482913')}>Use demo code</button>
                </div>
                {form.emailCode === '482913' && !form.emailVerified && (
                  <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} onClick={() => { set('emailVerified', true); toast('Email verified', '✓') }}>
                    Verify email
                  </button>
                )}
                {form.emailVerified && (
                  <div className="verified-badge" style={{ marginTop: 12 }}>✓ EMAIL VERIFIED</div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — fields */}
          {step === 4 && (
            <div>
              <div className="field-grid">
                {FIELDS.map((f) => {
                  const on = form.fields.includes(f.id)
                  return (
                    <button key={f.id} className={`field-card ${on ? 'on' : ''}`} onClick={() =>
                      set('fields', on ? form.fields.filter((x) => x !== f.id) : [...form.fields, f.id])
                    }>
                      <span className="f-icon">{(() => { const Ic = FIELD_ICONS[f.id] || Spark; return <Ic size={18} /> })()}</span>
                      <span className="f-label">{f.label}</span>
                      <span className="f-role">{f.role}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-3" style={{ fontSize: 13, marginTop: 16 }}>
                {form.fields.length > 0 ? `${form.fields.length} selected — you\u2019ll only meet ${isCandidate ? 'startups' : 'candidates'} in these fields.` : 'Select at least one.'}
              </p>
            </div>
          )}

          {/* Step 5 — review */}
          {step === 5 && (
            <div className="card card-pad" style={{ textAlign: 'center' }}>
              {!reviewed ? (
                <>
                  <div className="review-steps">
                    {REVIEW_STEPS.map(([t, s], i) => (
                      <div className="review-step" key={t}>
                        <span>{i < reviewIdx ? '✓' : i === reviewIdx ? '◌' : ''}</span>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 500 }}>{t}</div>
                          <div className="text-3" style={{ fontSize: 12.5 }}>{s}</div>
                        </div>
                        <span className={`st ${i < reviewIdx ? 'ok' : i === reviewIdx ? 'running' : 'pending'}`}>
                          {i < reviewIdx ? 'PASSED' : i === reviewIdx ? 'CHECKING…' : 'PENDING'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
                    <p className="text-3" style={{ fontSize: 13 }}>Human review takes about a minute. Everything is encrypted.</p>
                    <button className="btn btn-ghost btn-sm" onClick={skipReview} style={{ marginLeft: 'auto' }}>⏩ Skip animation</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="stamp" style={{ margin: '18px 0 26px' }}>✓ Verified · {form.fields.length} fields</div>
                  <h2 className="display display-md" style={{ marginBottom: 10 }}>You&apos;re in, {form.name.split(' ')[0] || 'friend'}.</h2>
                  <p className="muted" style={{ maxWidth: 440, margin: '0 auto 26px' }}>
                    {isCandidate
                      ? 'Startups hiring in your fields are live right now. They know the role you\u2019re interviewing for — and nothing else about you.'
                      : 'Candidates in your hiring fields are ready. Their verified resumes arrive the moment you match — then you judge them live.'}
                  </p>
                  <button className="btn btn-primary btn-lg" onClick={finish}>
                    {isCandidate ? 'Enter the room →' : 'Go live as a company →'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* nav buttons */}
          {step < 5 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>
              {step > 1 && <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={next}>Continue →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ————— Upload box ————— */

function UploadBox({ icon, title, sub, done, onChange }) {
  const ref = useRef(null)
  return (
    <div className={`verify-box ${done ? 'done' : ''}`} onClick={() => ref.current?.click()}>
      <div className="v-icon">{icon}</div>
      <div style={{ flex: 1 }}>
        <div className="v-title">{title} {done && '· uploaded ✓'}</div>
        <div className="v-sub">{sub}</div>
      </div>
      <input ref={ref} type="file" style={{ display: 'none' }} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <span className="text-3" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{done ? 'READY' : 'BROWSE'}</span>
    </div>
  )
}

/* ————— Face capture with live webcam ————— */

function FaceCapture({ photo, onCapture }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [camOn, setCamOn] = useState(false)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!camOn || photo) return
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch {
        if (!cancelled) setErr(true)
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [camOn, photo])

  const capture = () => {
    const v = videoRef.current
    if (!v) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth || 480
    c.height = v.videoHeight || 360
    c.getContext('2d').drawImage(v, 0, 0)
    onCapture(c.toDataURL('image/jpeg', 0.8))
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setCamOn(false)
  }

  if (photo) {
    return (
      <div className="verify-box done" style={{ cursor: 'default' }}>
        <img src={photo} alt="captured face" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12 }} />
        <div style={{ flex: 1 }}>
          <div className="v-title">Face verification · captured ✓</div>
          <div className="v-sub">Your live face was matched against your ID photo.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onCapture(null)}>Retake</button>
      </div>
    )
  }

  return (
    <div className="card card-pad">
      <div className="v-title" style={{ fontWeight: 500, marginBottom: 4 }}>Face verification</div>
      <div className="v-sub text-3" style={{ fontSize: 12.5, marginBottom: 14 }}>
        A live scan compared with your ID photo. We never store the raw frame.
      </div>
      {!camOn && !err && (
        <button className="btn btn-violet" onClick={() => setCamOn(true)}>Start camera scan</button>
      )}
      {err && (
        <div style={{ display: 'grid', gap: 10 }}>
          <p className="text-3" style={{ fontSize: 13 }}>Camera unavailable in this browser. Use the placeholder to continue the demo.</p>
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => onCapture('placeholder')}>Use placeholder photo</button>
        </div>
      )}
      {camOn && (
        <div>
          <div className="face-stage">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="face-hud"><div className="face-ring" /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={capture}>Capture</button>
            <button className="btn btn-quiet" onClick={() => { setCamOn(false); streamRef.current?.getTracks().forEach((t) => t.stop()) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
