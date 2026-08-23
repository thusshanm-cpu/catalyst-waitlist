import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { Match } from '../match.js'
import { track } from '../analytics.js'
import { generateSummary } from '../summary.js'
import { buildSummary } from '../data.js'
import { ChatBubble, Calendar, Bookmark, ArrowRight, Spark } from '../components/icons.jsx'

const DECISIONS = [
  { id: 'continued', icon: <ChatBubble size={22} />, title: 'Keep talking', sub: 'Extend this session now' },
  { id: 'followup', icon: <Calendar size={22} />, title: 'Request follow-up', sub: 'A longer, scheduled interview' },
  { id: 'saved', icon: <Bookmark size={22} />, title: 'Save connection', sub: 'Keep in touch, decide later' },
  { id: 'skipped', icon: <ArrowRight size={22} />, title: 'Skip to next match', sub: 'Respectful, no awkwardness' },
]

export default function PostSession() {
  const { state, api } = useStore()
  const { toast } = useToast()
  const s = state.session
  const isEmployer = state.user?.role === 'employer'

  const [decision, setDecision] = useState(null)
  const [rec, setRec] = useState(false)
  const [ai, setAi] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [summary, setSummary] = useState(null)
  const [dims, setDims] = useState(null)
  const [aiSource, setAiSource] = useState('AI ASSISTANT · observations only · no hiring decision')

  const summaryData = buildSummary(isEmployer ? 'employer' : 'candidate')
  const real = s?.mode === 'real'
  const [peerDecision, setPeerDecision] = useState(null)
  const decisionLabel = (id) => DECISIONS.find((d) => d.id === id)?.title ?? id

  useEffect(() => {
    if (!real) return
    return Match.on('remote-decision', setPeerDecision)
  }, [real])

  const pick = (d) => {
    setDecision(d)
    const dObj = DECISIONS.find((x) => x.id === d)
    toast(`${dObj.title} — ${d === 'skipped' ? 'moving on' : 'noted'}`, d === 'skipped' ? '↪' : '✓')
    if (real) Match.sendDecision(d)
    track('decision', { decision: d, mode: real ? 'real' : 'demo', role: s?.roleType, field: s?.field })
  }

  const generate = async () => {
    setAnalyzing(true)
    setSummary(null)
    setDims(null)
    const res = await generateSummary({ events: s.transcript || [], role: s.role, field: s.field })
    if (res.real) {
      // LLM summary built from the real session transcript
      setAiSource('AI ASSISTANT · LLM-generated from this session · observations only')
      setAnalyzing(false)
      setSummary({ headline: res.headline, strengths: res.strengths, growth: res.growth })
      setDims(res.dims.map((d) => ({ ...d, v: 0 })))
      setTimeout(() => setDims(res.dims), 200)
    } else {
      // Edge Function not deployed yet — honest demo fallback
      setAiSource('AI ASSISTANT · demo summary (LLM not wired) · no hiring decision')
      setTimeout(() => {
        setAnalyzing(false)
        setSummary(summaryData)
        setDims(summaryData.dims.map((d) => ({ ...d, v: 0 })))
        setTimeout(() => setDims(summaryData.dims), 200)
      }, 2600)
    }
  }

  useEffect(() => {
    if (!s) api.navigate('dashboard')
  }, [s, api])

  if (!s) return null

  return (
    <div className="shell post-session">
      <div className="container shell-main" style={{ maxWidth: 900 }}>
        <button className="back-link" onClick={() => api.newSession()}>← Back to dashboard</button>

        <div className="post-hero">
          <div className="check-big">✓</div>
          <h1>Session complete.</h1>
          <p>
            {s.role} · {s.roleType} with <strong style={{ color: 'var(--text)' }}>{s.counterpart.name}</strong> — {fmt(s.duration)}.
            The room is closed. Now it&apos;s your call.
          </p>
        </div>

        {/* ————— Decision ————— */}
        {real && (
          <div className="session-notes" style={{ textAlign: 'center', margin: '6px 0 -6px', fontSize: 13 }}>
            {peerDecision
              ? <>Your peer chose: <strong style={{ color: 'var(--mint)' }}>{decisionLabel(peerDecision)}</strong></>
              : decision
                ? 'Decision sent to your peer — waiting on theirs…'
                : 'This is a live match — both sides make the same call, in real time.'}
          </div>
        )}
        <div className="decision-grid">
          {DECISIONS.map((d) => (
            <button key={d.id} className={`decision-card ${decision === d.id ? 'picked' : ''}`} onClick={() => pick(d.id)}>
              <div className="d-icon">{d.icon}</div>
              <div className="d-title">{d.title}</div>
              <div className="d-sub">{d.sub}</div>
            </button>
          ))}
        </div>

        {/* ————— Consent-gated AI summary ————— */}
        <div className="consent-panel">
          <h3>Optional: recording &amp; AI-assisted summary</h3>
          <p>
            With both participants&apos; consent, this session can be analyzed to produce a
            structured summary. It supports the human decision — it never makes it. Decline
            and nothing is recorded, with no penalty.
          </p>
          <div className="toggle-row">
            <div>
              <div className="t-label">Record this session</div>
              <div className="t-sub">Encrypted, retained 30 days, deletable anytime</div>
            </div>
            <div className={`switch ${rec ? 'on' : ''}`} onClick={() => setRec((r) => !r)} />
          </div>
          <div className="toggle-row">
            <div>
              <div className="t-label">Generate an AI summary</div>
              <div className="t-sub">Communication, adaptability, collaboration signals — no verdicts</div>
            </div>
            <div className={`switch ${ai ? 'on' : ''}`} onClick={() => setAi((a) => !a)} />
          </div>
          {ai && (
            <button className="btn btn-violet" style={{ marginTop: 16 }} onClick={generate} disabled={analyzing}>
              {analyzing ? 'Analyzing session…' : 'Analyze my session →'}
            </button>
          )}

          {analyzing && (
            <div className="typing-bar">
              <span className="typing-dots"><i /><i /><i /></span>
              Reading the transcript, mapping pressure moments…
            </div>
          )}

          {!ai && !rec && !analyzing && (
            <p className="text-3" style={{ fontSize: 12.5, marginTop: 16 }}>
              No recording, no analysis — you&apos;re free. The interviewer&apos;s own notes are the only record.
            </p>
          )}
          {rec && !ai && !analyzing && (
            <p className="text-3" style={{ fontSize: 12.5, marginTop: 16 }}>
              Recording on. The AI summary stays off until you enable it — nothing is analyzed.
            </p>
          )}

          {summary && (
            <div className="ai-panel">
              <div className="ai-head">
                <div className="ai-icon"><Spark size={18} /></div>
                <div>
                  <h3>Session summary</h3>
                  <div className="ai-sub">{aiSource}</div>
                </div>
                <div className="ai-note">Generated from the consented recording · 10-min session</div>
              </div>
              <p style={{ fontSize: 14.5, color: 'var(--text)', lineHeight: 1.6, marginBottom: 20 }}>{summary.headline}</p>
              <div className="ai-dim-grid">
                {dims?.map((d) => (
                  <div className="ai-dim" key={d.k}>
                    <span className="ad-label">{d.k}</span>
                    <span className="ad-bar"><i style={{ width: `${d.v}%` }} /></span>
                    <span className="ad-val">{d.v}</span>
                  </div>
                ))}
              </div>
              <div className="ai-cols">
                <div className="ai-col">
                  <h4>What stood out</h4>
                  <ul>{summary.strengths.map((t) => <li key={t}><span className="mint">✓</span>{t}</li>)}</ul>
                </div>
                <div className="ai-col">
                  <h4>Sharpen next time</h4>
                  <ul>{summary.growth.map((t) => <li key={t}><span className="amber">→</span>{t}</li>)}</ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ————— Employer unlock ————— */}
        {isEmployer && (
          <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600 }}>Interested?</h3>
              <p className="text-2" style={{ fontSize: 13.5, marginTop: 6 }}>
                Unlock the candidate&apos;s verified profile — resume, education, links, and
                credentials. The resume finally shows up, last.
                {real && ' (Live peer — this prototype shows sample data.)'}
              </p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => { api.navigate('profile'); toast('Profile unlocked — you met the person first', '🔓') }}>
              Unlock verified profile →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
