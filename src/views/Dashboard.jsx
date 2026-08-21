import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { Match } from '../match.js'
import { track } from '../analytics.js'
import { CANDIDATE_QUEUE, CANDIDATES, EMPLOYER_QUEUE, STARTUPS, fieldLabel, SIMULATIONS } from '../data.js'
import { FIELD_ICONS, SIM_ICONS, Calendar, Compass, Spark } from '../components/icons.jsx'

/* the candidate's verified profile as a shareable resume snapshot */
const resumeOf = (u) => ({
  name: u?.name || 'Verified candidate',
  school: u?.school || '',
  program: u?.program || (u?.fields?.length ? `${u.fields.map(fieldLabel).join(' · ')}` : ''),
  location: u?.location || '',
  resumeName: u?.resumeName || '',
  bullets: [
    'Finalist, regional case competition',
    'Led a 4-person project sprint',
    'Built a portfolio of applied coursework',
  ],
  links: { github: 'github.com/you', linkedin: 'in/you', portfolio: 'you.dev' },
  certs: ['Verified on Catalyst'],
  verified: ['ID verified', 'Face matched', 'School email confirmed'],
})

export default function Dashboard() {
  const { state, api } = useStore()
  const { toast } = useToast()
  const user = state.user
  const isCandidate = user?.role === 'candidate'
  const [demo, setDemo] = useState(false)
  const [mode, setMode] = useState('demo') // 'demo' | 'real'
  const [searching, setSearching] = useState(null) // field being searched for a live peer
  const [presence, setPresence] = useState([])
  const [channelLabel, setChannelLabel] = useState(null)

  useEffect(() => {
    Match.init({ role: user?.role, fields: user?.fields, resume: isCandidate ? resumeOf(user) : null })
    setChannelLabel(Match.channelInfo())
    const off = Match.on('presence', setPresence)
    return () => { off(); Match.cancelSearch() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.fields, isCandidate])

  const mainField = user?.fields?.[0] || 'software'
  const fields = user?.fields?.length ? user.fields : ['software']
  const queueFor = (fid) => {
    const q = (isCandidate ? CANDIDATE_QUEUE : EMPLOYER_QUEUE).find((x) => x.field === fid)
    return q || (isCandidate
      ? { id: 'q-' + fid, field: fid, roleType: 'Intern', hiring: 2, region: 'Anywhere' }
      : { id: 'e-' + fid, field: fid, sessionNote: 'Verified candidate · ready now' })
  }
  const queue = fields.map(queueFor).slice(0, 3)

  const launch = (field, roleType, opts = {}) => {
    const anon = opts.anon
    const counterpart = isCandidate
      ? (anon
        ? { anon: true, name: 'Verified startup', title: `Hiring ${fieldLabel(field)} · ${anon.roleType || 'Intern'}`, org: '', you: 'Candidate' }
        : { name: STARTUPS[0].founder, title: STARTUPS[0].title, org: STARTUPS[0].name, tagline: STARTUPS[0].tagline, you: 'Candidate' })
      : (anon
        ? { anon: true, name: anon.resume?.name || 'Verified student', title: anon.resume ? `${anon.resume.program || fieldLabel(field)} · ${anon.resume.school || 'Verified student'}` : `${anon.note} · ${fieldLabel(field)}`, org: '', resume: anon.resume || null, you: 'Employer' }
        : { name: CANDIDATES[0].name, title: CANDIDATES[0].program, org: CANDIDATES[0].school, resume: { name: CANDIDATES[0].name, school: CANDIDATES[0].school, program: CANDIDATES[0].program, location: 'Toronto, Canada', resumeName: 'maya_chen_resume.pdf', bullets: CANDIDATES[0].resume, links: CANDIDATES[0].links, certs: CANDIDATES[0].certs, verified: CANDIDATES[0].verified }, you: 'Employer' })

    api.startSession({
      id: Date.now(),
      phase: 'connecting',
      role: fieldLabel(field),
      roleType,
      field,
      mode: opts.real ? 'real' : 'demo',
      anonId: anon?.anonId,
      duration: demo ? 90 : 600,
      introSecs: demo ? 15 : 60,
      perspective: isCandidate ? 'candidate' : 'employer',
      counterpart,
      simulation: null,
      events: [],
      consent: { recording: false, ai: false },
      choices: {},
    })
  }

  const start = (field, roleType) => {
    if (mode === 'demo') { launch(field, roleType); return }
    if (searching) return // already searching — don't stack listeners

    // Real mode: find a live peer on another device, fall back to a simulated match
    setSearching(field)
    const off = Match.on('match', (m) => {
      off()
      setSearching(null)
      launch(m.field || field, roleType, { real: true, anon: m.peer })
      track('match_started', { role: roleType, field: m.field || field })
      toast('Live peer matched — secure link established', '🔗')
    })
    const ok = Match.startSearch(field)
    if (!ok) {
      off()
      setSearching(null)
      toast('Live matching unsupported here — using a simulated match', '⚠️')
      launch(field, roleType)
      return
    }
    // Give real users a real window to press start on the other device.
    // If no one shows up, fall back to a simulated match — clearly labeled.
    setTimeout(() => {
      if (Match.matchedInfo()) return
      off()
      setSearching(null)
      Match.cancelSearch()
      toast('No live peer found in 25s — starting a simulated match instead', '🎭')
      launch(field, roleType)
    }, 25000)
  }

  const histStatus = { saved: { t: 'Saved', c: 'saved' }, followup: { t: 'Follow-up asked', c: 'followup' }, continued: { t: 'Kept talking', c: 'saved' }, time: { t: 'Time up', c: 'saved' }, ended: { t: 'Ended', c: 'skipped' }, skipped: { t: 'Skipped', c: 'skipped' } }

  return (
    <div className="shell">
      <div className="container">
        <div className="app-bar">
          <div className="brand" onClick={() => api.navigate('landing')}>Catalyst</div>
          {isCandidate ? <span className="verified-badge">✓ VERIFIED</span> : <span className="verified-badge">✓ VERIFIED COMPANY</span>}
          <div className="user-chip">
            <span className="text-2" style={{ fontSize: 13 }}>{user?.company || user?.school || 'You'}</span>
            <div className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
              {user?.avatar ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : (user?.name || 'Y').split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
          </div>
        </div>

        <div className="dash-head" style={{ marginTop: 34 }}>
          <div>
            <h1>{isCandidate ? `Ready when you are, ${user?.name?.split(' ')[0] || 'there'}.` : `${user?.company || 'Your startup'} — live hiring.`}</h1>
            <div className="sub">
              {isCandidate
                ? `You're verified for ${user?.fields?.map(fieldLabel).join(', ') || 'your fields'}. Blind matches below — the company stays hidden until after the session.`
                : `Candidates in ${user?.fields?.map(fieldLabel).join(', ') || 'your fields'} can see the role — never your company name.`}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
            <div className="persp-toggle" title="Demo: scripted counterpart · Live: real peer">
              <button className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>DEMO MATCH</button>
              <button className={mode === 'real' ? 'on' : ''} onClick={() => setMode('real')}>LIVE MATCH</button>
            </div>
            {channelLabel && (
              <span className="text-3" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                {channelLabel === 'supabase' ? '● cross-device matching on' : '● same-device only'}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="text-3" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>DEMO SPEED</span>
              <div className={`switch ${demo ? 'on' : ''}`} onClick={() => setDemo((d) => !d)} title="90-second sessions for demos" />
            </div>
          </div>
        </div>

        {presence.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {presence.map((p) => (
              <span key={p.role + p.field} className="sim-tag" style={{ color: 'var(--ember-soft)', borderColor: 'rgba(95,237,131,.4)', background: 'rgba(95,237,131,.06)' }}>
                <span className="live-dot" style={{ display: 'inline-block', marginRight: 6, width: 7, height: 7 }} />
                {p.count} verified {p.role === 'candidate' ? 'student' : 'startup'} live in {fieldLabel(p.field)}
              </span>
            ))}
          </div>
        )}

        {/* ————— Match card ————— */}
        <div className="match-card">
          <div className="mc-body">
            <div className="mc-kicker">{isCandidate ? 'Next blind match' : 'Go live — anonymous candidates'}</div>
            <h2>
              {isCandidate
                ? `${fieldLabel(mainField)} · ${'Intern'}`
                : `3 candidates ready in ${fieldLabel(mainField)}`}
            </h2>
            <p>
              {mode === 'real'
                ? (isCandidate
                  ? 'Have a startup press start on another device or tab — you\u2019ll match each other live, still blind. Falls back to a simulated match if no one is there.'
                  : 'Have a student press start on another device or tab — you\u2019ll meet a live candidate, blind, on the role only.')
                : (isCandidate
                  ? '3 verified startups are hiring this role right now. You\u2019ll know the role — not the company.'
                  : 'The candidate\u2019s verified resume lands in your hands the moment you match — then you judge how they think, live.')}
            </p>
          </div>
          <button className="btn btn-primary btn-lg" disabled={!!searching} onClick={() => start(mainField, 'Intern')}>
            {searching ? 'Searching for a live peer…' : (isCandidate ? 'Start a 10-minute session' : 'Meet the next candidate')}{!searching && ' →'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 22, alignItems: 'start' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              {isCandidate ? 'More live matches' : 'Live queue'}
            </h3>
            <div className="queue-list">
              {queue.map((q) => (
                  <button key={q.id} className="queue-item" onClick={() => start(q.field || mainField, q.roleType || 'Intern')}>
                    <span className="q-icon">{(() => { const Ic = FIELD_ICONS[q.field || mainField] || Compass; return <Ic size={18} /> })()}</span>
                    <span>
                      <span className="q-title">{fieldLabel(q.field || mainField)} {q.roleType ? `· ${q.roleType}` : ''}</span>
                      <span className="q-sub" style={{ display: 'block' }}>
                        {isCandidate ? `${q.hiring} verified startups hiring · ${q.region}` : q.sessionNote}
                      </span>
                    </span>
                    <span className="q-meta">{isCandidate ? 'NOW' : 'NOW'} <span className="arrow">→</span></span>
                  </button>
                ))}
              {!isCandidate && (
                <div className="queue-item" style={{ cursor: 'default' }}>
                  <span className="q-icon">{(() => { const Ic = FIELD_ICONS[mainField]; return <Ic size={18} /> })()}</span>
                  <span>
                    <span className="q-title">Employer simulation shortcuts</span>
                    <span className="q-sub" style={{ display: 'block' }}>Launch a live scenario any time, mid-session</span>
                  </span>
                  <span className="q-meta">IN-SESSION</span>
                </div>
              )}
            </div>

            {isCandidate && (
              <>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, margin: '34px 0 4px' }}>
                  Simulation practice room
                </h3>
                <p className="text-3" style={{ fontSize: 13, marginBottom: 12 }}>
                  These are exactly the scenarios startups will throw at you. Try one blind.
                </p>
                <div className="queue-list">
                  {(SIMULATIONS[mainField] || SIMULATIONS.software).map((s) => (
                    <button key={s.id} className="queue-item" onClick={() => { toast(`${s.title} — starting your blind match`, '🎯'); start(mainField, 'Intern') }}>
                      <span className="q-icon">{(() => { const Ic = SIM_ICONS[s.id] || Spark; return <Ic size={18} /> })()}</span>
                      <span>
                        <span className="q-title">{s.title}</span>
                        <span className="q-sub" style={{ display: 'block' }}>{s.kicker}</span>
                      </span>
                      <span className="arrow">→</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ————— History ————— */}
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Session history</h3>
            <div className="card" style={{ padding: '8px 20px' }}>
              {state.history.length ? state.history.map((h) => {
                const s = histStatus[h.decision] || histStatus.skipped
                return (
                  <div className="hist-item" key={h.id || h.counterpart + h.when}>
                    <div>
                      <div className="h-label">{h.role} {h.roleType}</div>
                      <div className="h-sub">{h.counterpart} · {h.when}</div>
                    </div>
                    <span className={`hist-status ${s.c}`}>{s.t}</span>
                  </div>
                )
              }) : (
                <div className="empty-state">
                  <span className="empty-ic"><Calendar size={17} /></span>
                  <strong>No sessions yet</strong>
                  <span>Your first blind match lands here — start one above.</span>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 20, marginTop: 22 }}>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{isCandidate ? 'How a session runs' : 'Session controls'}</h4>
              <ul style={{ listStyle: 'none', display: 'grid', gap: 7 }}>
                {(isCandidate ? [
                  'Blind match → 3-2-1 countdown → live video',
                  'Employer sets the scene for ~1 minute',
                  'Then it\u2019s unscripted — simulations included',
                  'Either side can skip, respectfully, anytime',
                ] : [
                  'Set the scene in the first minute',
                  'Launch a simulation any time',
                  'Ping an unexpected change mid-session',
                  'Unlock a profile if you want to keep going',
                ]).map((t) => (
                  <li key={t} style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', gap: 9 }}><span style={{ color: 'var(--ember)' }}>·</span>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
