import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { Match } from '../match.js'
import { useCall } from '../call.js'
import { track } from '../analytics.js'
import { SIMULATIONS, EVENTS, fieldLabel } from '../data.js'
import { Mic, Pencil, Eraser, Trash, Zap, FileText, X, Spark, SIM_ICONS } from '../components/icons.jsx'

const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`

const fmtAnswer = (a) => {
  switch (a.type) {
    case 'choice': return `Answered: ${a.choice} — ${a.correct ? 'the right pick' : 'not the intended pick'}`
    case 'rank': return `Ranked the cut: ${a.ranked.map((r, i) => `${i + 1}. ${r}`).join('  ·  ')}`
    case 'campaign': return `Shipped $${a.budget}k defending “${a.metric}”`
    case 'pitch': return a.phase === 'after' ? 'Finished the pitch — handling the objection' : 'Started the 90-second pitch'
    case 'handled': return `Handled the curveball: ${a.title}`
    default: return ''
  }
}

export default function Session() {
  const { state, api } = useStore()
  const s = state.session
  const { toast } = useToast()
  const [phase, setPhase] = useState('connecting') // connecting | countdown | live
  const [elapsed, setElapsed] = useState(0)
  const [activeSim, setActiveSim] = useState(null)
  const [activeEvent, setActiveEvent] = useState(null)
  const [wbOpen, setWbOpen] = useState(false)
  const [perspective, setPerspective] = useState(s?.perspective || 'candidate')
  const [mmLog, setMmLog] = useState('Finding verified matches…')
  const [peerOnline, setPeerOnline] = useState(true)
  const [peerLeftDismissed, setPeerLeftDismissed] = useState(false)
  const [activity, setActivity] = useState([])
  const firedEvent = useRef(false)
  const ended = useRef(false)
  const wbRemote = useRef(false)
  const wbSent = useRef(false) // matches the initial wbOpen state

  const real = s?.mode === 'real'
  const persp = real ? (s?.perspective || 'candidate') : perspective
  const isCandidate = persp === 'candidate'
  const isLive = phase === 'live'
  const inIntro = isLive && elapsed < s.introSecs
  const call = useCall({ enabled: real, amOfferer: real ? Match.amOfferer() : false })
  useEffect(() => {
    if (!s) api.navigate('dashboard')
  }, [s, api])

  /* analytics: did the call actually connect? */
  const connectedTracked = useRef(false)
  const failedTracked = useRef(false)
  useEffect(() => {
    if (!real) return
    if (call.status === 'connected' && !connectedTracked.current) {
      connectedTracked.current = true
      track('call_connected', { role: s?.roleType, field: s?.field })
    } else if (call.status === 'failed' && !failedTracked.current) {
      failedTracked.current = true
      track('call_failed', { role: s?.roleType, field: s?.field })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.status, real, s?.roleType, s?.field])

  /* if the peer's heartbeat comes back (transient drop), clear the overlay */
  useEffect(() => {
    if (peerOnline && peerLeftDismissed) setPeerLeftDismissed(false)
  }, [peerOnline, peerLeftDismissed])

  /* live peer relay — real cross-tab matches */
  useEffect(() => {
    if (!real || !s) return
    setPeerOnline(Match.isPeerOnline())
    const offs = [
      Match.on('remote-sim', (id) => {
        const sim = (SIMULATIONS[s.field] || SIMULATIONS.software).find((x) => x.id === id)
        if (sim) setActiveSim(sim)
      }),
      Match.on('remote-event', (ev) => setActiveEvent(ev)),
      Match.on('remote-wb', (open) => {
        wbRemote.current = true
        setWbOpen(open)
        if (open) Match.sendWbAck()
        toast(open ? 'Peer opened the shared whiteboard' : 'Peer closed the whiteboard', '📝')
      }),
      Match.on('remote-sim-answer', (a) => setActivity((prev) => [{ ...a, at: Date.now() }, ...prev].slice(0, 8))),
      Match.on('remote-event-handled', (title) => {
        setActivity((prev) => [{ type: 'handled', title, at: Date.now() }, ...prev].slice(0, 8))
        toast('Candidate handled the curveball', '✓')
      }),
      Match.on('remote-sim-close', () => {
        setActiveSim(null)
        toast('Employer closed the scenario', '✕')
      }),
      Match.on('remote-end', () => endNow(true)),
      Match.on('peer-offline', () => {
        setPeerOnline(false)
        track('peer_left', { role: s?.roleType, field: s?.field })
      }),
    ]
    const iv = setInterval(() => setPeerOnline(Match.isPeerOnline()), 2500)
    return () => { offs.forEach((o) => o()); clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, s?.field])

  /* let the peer know when the shared whiteboard opens/closes */
  useEffect(() => {
    if (!real) return
    if (wbRemote.current) { wbRemote.current = false; return }
    if (wbSent.current === wbOpen) return
    wbSent.current = wbOpen
    pushTranscript({ t: 'whiteboard', detail: wbOpen ? 'opened' : 'closed' })
    Match.sendWb(wbOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, wbOpen])

  const remain = s ? Math.max(0, s.duration - elapsed) : 0

  /* matchmaking → countdown → live */
  useEffect(() => {
    if (phase !== 'connecting') return
    if (real) {
      // async matching: the peer may take a moment to arrive — wait for them
      let cancelled = false
      let iv = null
      let t = null
      const proceed = () => {
        setMmLog('Secure link established — peer confirmed live')
        t = setTimeout(() => setPhase('countdown'), 800)
      }
      if (Match.isPeerOnline()) {
        proceed()
      } else {
        setMmLog('Waiting for your match to join…')
        iv = setInterval(() => {
          if (cancelled) return
          if (Match.isPeerOnline()) {
            clearInterval(iv)
            proceed()
          }
        }, 1500)
      }
      return () => { cancelled = true; if (iv) clearInterval(iv); if (t) clearTimeout(t) }
    }
    const logs = [
      `Searching verified startups · ${s.role}…`,
      '3 matches found · narrowing by field…',
      `Matched · they know the role — not you.`,
    ]
    const t1 = setTimeout(() => setMmLog(logs[0]), 100)
    const t2 = setTimeout(() => setMmLog(logs[1]), 1400)
    const t3 = setTimeout(() => { setMmLog(logs[2]); setPhase('countdown') }, 2900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, s.role, real])

  useEffect(() => {
    if (phase !== 'countdown') return
    const t = setTimeout(() => setPhase('live'), 3300)
    return () => clearTimeout(t)
  }, [phase])

  /* session clock */
  useEffect(() => {
    if (phase !== 'live') return
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(iv)
  }, [phase])

  /* auto end */
  useEffect(() => {
    if (isLive && elapsed >= s.duration && !ended.current) {
      ended.current = true
      if (real) Match.sendEnd()
      pushTranscript({ t: 'end', detail: 'time up' })
      track('session_ended', { decision: 'time', mode: real ? 'real' : 'demo', role: s?.roleType, field: s?.field })
      api.endSession({ decision: 'time' })
      toast(`Time\u2019s up — ${fmt(s.duration)}. Decision time.`, '⏱️')
    }
  }, [isLive, elapsed, s.duration, api, toast])

  /* auto-fire one unexpected event mid-session (and let employers fire more) */
  useEffect(() => {
    if (!isLive || inIntro || activeSim || activeEvent || wbOpen) return
    if (elapsed > s.introSecs + Math.floor(s.duration * 0.35) && !firedEvent.current) {
      firedEvent.current = true
      fireEvent()
    }
  }, [isLive, inIntro, elapsed, activeSim, activeEvent, wbOpen, s.introSecs, s.duration])

  /* session transcript — the real record the AI summary is built from */
  const transcriptRef = useRef(s?.transcript || [])
  const pushTranscript = useCallback((entry) => {
    transcriptRef.current = [...transcriptRef.current, { ...entry, at: Date.now() }].slice(-60)
    api.updateSession({ transcript: transcriptRef.current })
  }, [api])

  useEffect(() => {
    if (!real) return
    const offs = [
      Match.on('local-sim-answer', (a) => pushTranscript({ t: 'answer', detail: a.type })),
      Match.on('remote-sim-answer', (a) => pushTranscript({ t: 'peer_answer', detail: a.type })),
    ]
    return () => offs.forEach((o) => o())
  }, [real, pushTranscript])

  const fireEvent = useCallback(() => {
    const unused = EVENTS.filter((e) => !s.events.includes(e.id))
    const pool = unused.length ? unused : EVENTS
    const ev = pool[Math.floor(Math.random() * pool.length)]
    setActiveEvent({ ...ev })
    pushTranscript({ t: 'curveball', detail: ev.title })
    api.updateSession({ events: [...new Set([...s.events, ev.id])] })
    if (real && !isCandidate) Match.sendEvent({ ...ev })
    if (!real && persp === 'employer') toast('Unexpected change sent to the candidate', '⚡')
  }, [api, s.events, real, persp, isCandidate, pushTranscript, toast])

  const launchSim = (id) => {
    const sim = (SIMULATIONS[s.field] || SIMULATIONS.software).find((x) => x.id === id)
    if (!sim) return
    setActiveSim(sim)
    pushTranscript({ t: 'sim_launched', detail: sim.title })
    if (real && !isCandidate) Match.sendSim(id)
    if (!real && persp === 'candidate') toast('Scenario incoming — good luck', '🎯')
  }

  const endNow = (fromRemote = false) => {
    if (ended.current) return
    ended.current = true
    if (real && !fromRemote) Match.sendEnd()
    pushTranscript({ t: 'end', detail: 'ended' })
    track('session_ended', { decision: 'ended', mode: real ? 'real' : 'demo', role: s?.roleType, field: s?.field })
    api.endSession({ decision: 'ended' })
  }

  return (
    <div className="session-shell">
      {/* ————— Top bar ————— */}
      <div className="session-top">
        <span className="live-dot" />
        <span className="mock-live">{isLive ? 'LIVE' : phase === 'countdown' ? 'MATCHED' : 'CONNECTING'}</span>
        <span className={`st-phase ${inIntro ? '' : 'unscripted'}`}>
          {phase === 'connecting' ? 'matching' : phase === 'countdown' ? 'hold tight' : inIntro ? 'intro · employer sets the scene' : 'unscripted'}
        </span>
        {real
          ? <span className="st-phase" style={{ color: peerOnline ? 'var(--mint)' : 'var(--amber)', borderColor: peerOnline ? 'rgba(63,185,80,.4)' : 'rgba(210,153,34,.4)', background: peerOnline ? 'rgba(63,185,80,.08)' : 'rgba(210,153,34,.08)' }}>{peerOnline ? (call.status === 'connected' ? 'PEER LIVE · VIDEO' : call.status === 'failed' ? 'VIDEO UNAVAILABLE' : 'PEER LIVE') : 'PEER LEFT'}</span>
          : <span className="st-phase" style={{ color: 'var(--text-2)', borderColor: 'var(--line-strong)', background: 'transparent' }}>DEMO MATCH</span>}
        <span className="st-spacer" />
        <span className="st-timer" style={{ color: remain < 30 && isLive ? 'var(--danger)' : 'var(--text)' }}>{fmt(remain)}</span>
        {!real && (
          <div className="persp-toggle" title="Demo: switch which side you're watching">
            <button className={isCandidate ? 'on' : ''} onClick={() => setPerspective('candidate')}>CANDIDATE</button>
            <button className={!isCandidate ? 'on' : ''} onClick={() => setPerspective('employer')}>EMPLOYER</button>
          </div>
        )}
        <button className="btn btn-danger btn-sm" onClick={() => endNow()}>End session</button>
      </div>

      {/* ————— Stage + rail ————— */}
      <div className="session-stage">
        <div className="video-area">
          {!wbOpen ? (
            <>
              <div className="video-main">
                {call.remoteStream ? (
                  <RemoteVideo
                    stream={call.remoteStream}
                    label={s.counterpart.name}
                    sub={`${s.counterpart.title}${s.counterpart.org ? ` · ${s.counterpart.org}` : ''}`}
                  />
                ) : (
                  <div className="counterpart-art">
                    <div className="big-orb"><span>{s.counterpart.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span></div>
                    <div className="cp-name">{s.counterpart.name}</div>
                    <div className="cp-role">{s.counterpart.title}{s.counterpart.org ? ` · ${s.counterpart.org}` : ''}</div>
                    {isLive && !inIntro && !activeSim && !activeEvent && (
                      <div className="session-notes" style={{ maxWidth: 380, margin: '18px auto 0' }}>
                        {isCandidate
                          ? 'They\u2019re reading you live — pacing, reasoning, recovery. There\u2019s no script to memorize, so be curious out loud.'
                          : 'Watch for how they think, not what they know. Ask one question that has no rehearsed answer.'}
                      </div>
                    )}
                  </div>
                )}
                {s.tagline && <div className="video-tag"><span className="mic">●</span>{isCandidate ? `${s.counterpart.title} · ${s.tagline}` : `${s.counterpart.title}`}</div>}
                {s.counterpart.anon && (
                  <div className="video-tag" style={{ right: 14, left: 'auto' }}>
                    <span className="live-dot" /> {!isCandidate && s.counterpart.resume
                      ? 'resume shared at match'
                      : (peerOnline ? 'secure link · identity hidden' : 'peer offline')}
                  </div>
                )}
              </div>

              <SelfTile stream={call.localStream} camOn={call.camOn} micOn={call.micOn} camFailed={call.camFailed} toggleCam={call.toggleCam} toggleMic={call.toggleMic} />

              {phase === 'connecting' && <Matchmaking log={mmLog} field={s.role} real={real} />}
              {phase === 'countdown' && <Countdown />}
              {real && isLive && !peerOnline && !peerLeftDismissed && (
                <PeerLeftOverlay onEnd={() => endNow()} onContinue={() => setPeerLeftDismissed(true)} />
              )}
              {activeEvent && <EventCard ev={activeEvent} onDone={() => { if (real && isCandidate) Match.sendEventHandled(activeEvent.title); setActiveEvent(null) }} />}
            </>
          ) : (
            <Whiteboard relay={real} />
          )}

          {activeSim && (
            <SimOverlay
              sim={activeSim}
              field={s.field}
              isCandidate={isCandidate}
              real={real}
              lastAnswer={activity.find((a) => a.sim === activeSim.id)}
              demo={s.duration < 300}
              onClose={() => { if (real && !isCandidate) Match.sendSimClose(activeSim.id); setActiveSim(null) }}
            />
          )}
        </div>

        {/* ————— Rail ————— */}
        <div className="session-rail">
          {isCandidate ? (
            <>
              <div className="rail-card">
                <h4>Your cues</h4>
                <ul style={{ listStyle: 'none', display: 'grid', gap: 9 }}>
                  {[
                    inIntro ? 'Right now: listen for the mission, the role, and the problems the team actually solves.' : 'Unscripted now. If a scenario lands, talk through your reasoning out loud.',
                    'Recovery matters more than being right the first time.',
                    'Either side can skip at any time — no awkward rejection.',
                  ].map((t) => (
                    <li key={t} style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'flex', gap: 8, lineHeight: 1.5 }}><span style={{ color: 'var(--ember)' }}>·</span>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="rail-card">
                <h4>Session tools</h4>
                <div className="rail-actions">
                  <button className="btn btn-ghost" onClick={() => setWbOpen((w) => !w)}>{wbOpen ? 'Back to video' : 'Open shared whiteboard'}</button>
                  <button className="btn btn-ghost" onClick={() => { toast('Respectfully skipping to the next verified match…', '↪'); endNow() }}>Skip to next match</button>
                </div>
              </div>
            </>
          ) : (
            <>
              {s.counterpart.resume && (
                <div className="rail-card resume-rail">
                  <h4>Candidate resume · shared at match</h4>
                  <div className="rr-head">
                    <div className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{s.counterpart.resume.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.counterpart.resume.name}</div>
                      <div className="text-3" style={{ fontSize: 12 }}>{s.counterpart.resume.program}{s.counterpart.resume.school ? ` · ${s.counterpart.resume.school}` : ''}</div>
                    </div>
                  </div>
                  {s.counterpart.resume.resumeName && (
                    <div className="rr-file" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={13} /> {s.counterpart.resume.resumeName} · verified on Catalyst</div>
                  )}
                  <ul className="rr-bullets">
                    {(s.counterpart.resume.bullets || []).slice(0, 3).map((b) => <li key={b}>{b}</li>)}
                  </ul>
                  {s.counterpart.resume.links && (
                    <div className="rr-links">
                      {Object.entries(s.counterpart.resume.links).map(([k, v]) => (
                        <span key={k} className="rr-link">{k === 'github' ? 'GH' : k === 'linkedin' ? 'IN' : 'PF'} · {v}</span>
                      ))}
                    </div>
                  )}
                  {s.counterpart.resume.certs?.length > 0 && (
                    <div className="rr-certs">
                      {s.counterpart.resume.certs.map((c) => <span key={c} className="v-chip">✓ {c}</span>)}
                    </div>
                  )}
                </div>
              )}
              <div className="rail-card">
                <h4>Set the scene</h4>
                <p className="session-notes" style={{ marginBottom: 12 }}>
                  First {Math.round(s.introSecs)} seconds: your mission, the role, and the problems your team solves. Then go unscripted.
                </p>
                <div className="sim-picker">
                  {(SIMULATIONS[s.field] || SIMULATIONS.software).map((sim) => (
                    <button key={sim.id} className={`sim-opt ${activeSim?.id === sim.id ? 'armed' : ''}`} onClick={() => launchSim(sim.id)}>
                      <span className="so-icon">{(() => { const Ic = SIM_ICONS[sim.id] || Spark; return <Ic size={16} /> })()}</span>
                      <span>
                        <span className="so-title" style={{ display: 'block' }}>{sim.title}</span>
                        <span className="so-sub">{sim.kicker}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {real && !isCandidate && (
                <div className="rail-card">
                  <h4>Candidate activity</h4>
                  {activity.length === 0 ? (
                    <p className="session-notes">Live updates appear here as the candidate works through scenarios.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', display: 'grid', gap: 8, maxHeight: 170, overflowY: 'auto' }}>
                      {activity.map((a, i) => (
                        <li key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, display: 'flex', gap: 8 }}>
                          <span style={{ color: 'var(--mint)', flexShrink: 0 }}>›</span>{fmtAnswer(a)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="rail-card">
                <h4>Unexpected changes</h4>
                <p className="session-notes" style={{ marginBottom: 12 }}>
                  Throw a curveball to see how the candidate adapts.
                </p>
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={fireEvent}><Zap size={14} /> Send an unexpected change</button>
              </div>
              <div className="rail-card">
                <h4>Collaboration</h4>
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setWbOpen((w) => !w)}>{wbOpen ? 'Back to video' : 'Open shared whiteboard'}</button>
              </div>
            </>
          )}

          <div className="rail-card">
            <h4>Consent</h4>
            <p className="session-notes">Recording &amp; AI analysis are off by default. They can only be enabled after the session, with both participants agreeing.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ————— Matchmaking ————— */

function Matchmaking({ log, field, real }) {
  return (
    <div className="mm-overlay">
      <div className="mm-inner">
        <div className="mm-rings">
          <div className="rr" /><div className="rr" /><div className="rr" />
          <div className="rr-core" />
        </div>
        <h3>{real ? 'Secure link established' : 'Finding your blind match'}</h3>
        <p>
          {real ? (
            <>A verified peer is in the room — <strong style={{ color: 'var(--text)' }}>{field}</strong>. Names stay hidden until after the session.</>
          ) : (
            <>They see the role: <strong style={{ color: 'var(--text)' }}>{field}</strong>. Nothing else about you.</>
          )}
        </p>
        <div className="mm-log">{log}</div>
      </div>
    </div>
  )
}

/* ————— Peer left ————— */

function PeerLeftOverlay({ onEnd, onContinue }) {
  return (
    <div className="pl-overlay">
      <div className="pl-card">
        <h3>Your match left the session</h3>
        <p>The live link dropped — your peer is no longer in the room. Your shared tools (whiteboard, simulations) stay open on your side.</p>
        <div className="pl-actions">
          <button className="btn btn-ghost" onClick={onContinue}>Keep the room open</button>
          <button className="btn btn-danger" onClick={onEnd}>End session</button>
        </div>
      </div>
    </div>
  )
}

/* ————— Countdown ————— */

function Countdown() {
  const [n, setN] = useState(3)
  useEffect(() => {
    if (n === 0) return
    const t = setTimeout(() => setN((x) => x - 1), 1000)
    return () => clearTimeout(t)
  }, [n])
  return (
    <div className="countdown-overlay">
      {n > 0 ? (
        <>
          <div className="count-num" key={n}>{n}</div>
          <div className="count-label">meet on the count</div>
        </>
      ) : (
        <>
          <div className="count-num" key="go" style={{ fontSize: 84, color: 'var(--mint)' }}>LIVE</div>
          <div className="count-label">the room is open — no scripts</div>
        </>
      )}
    </div>
  )
}

/* ————— Self tile (preview of the shared local stream) ————— */

function SelfTile({ stream, camOn, micOn, camFailed, toggleCam, toggleMic }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null
  }, [stream])

  return (
    <div className="self-tile">
      {camOn && stream && !camFailed ? <video ref={videoRef} autoPlay playsInline muted /> : (
        <div className="self-off">{camFailed ? 'camera blocked' : 'camera off'}</div>
      )}
      <div style={{ position: 'absolute', right: 6, top: 6, display: 'flex', gap: 5 }}>
        <button className="wb-tool" onClick={toggleMic} title="toggle mic" style={{ width: 26, height: 26 }}>
          <span style={{ color: micOn ? 'var(--mint)' : 'var(--text-3)' }}><Mic size={12} /></span>
        </button>
        <button className="wb-tool" onClick={toggleCam} title="toggle camera" style={{ width: 26, height: 26 }}>
          <span style={{ color: camOn ? 'var(--mint)' : 'var(--text-3)' }}>◉</span>
        </button>
      </div>
      <span className="you-tag">you {micOn ? '' : '· muted'}</span>
    </div>
  )
}

/* ————— Remote video ————— */

function RemoteVideo({ stream, label, sub }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])

  return (
    <div className="remote-video">
      <video ref={ref} autoPlay playsInline />
      <div className="rv-label">
        <span className="rv-name">{label}</span>
        {sub && <span className="rv-sub">{sub}</span>}
      </div>
    </div>
  )
}

/* ————— Unexpected event ————— */

function EventCard({ ev, onDone }) {
  return (
    <div className="event-card">
      <span className="ev-tag"><span className="live-dot" /> Unexpected change</span>
      <h4>{ev.title}</h4>
      <p>{ev.body}</p>
      <div className="ev-ask">{ev.ask}</div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 18 }} onClick={onDone}>Handled — back to the session</button>
    </div>
  )
}

/* ————— Simulation overlay ————— */

function SimOverlay({ sim, field, isCandidate, real = false, lastAnswer, demo, onClose }) {
  const canAnswer = isCandidate && real
  return (
    <div className="sim-overlay">
      <div className="sim-header">
        <span className="sh-tag">STARTUP SIMULATION · {fieldLabel(field).toUpperCase()}</span>
        <h3>{sim.title}</h3>
        {!isCandidate && <span className="text-3" style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>observing as employer</span>}
        <button className="btn btn-quiet btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close <X size={12} /></button>
      </div>
      <div className="sim-body">
        <p className="sim-brief"><span className="kicker">{sim.kicker}</span>{sim.brief}</p>
        {sim.id === 'debug' && <CodeBlock />}
        {sim.id === 'system' && <ChoiceBlock sim={sim} relay={canAnswer} />}
        {sim.id === 'crit' && <ChoiceBlock sim={sim} relay={canAnswer} />}
        {sim.id === 'debug' && <ChoiceBlock sim={sim} relay={canAnswer} />}
        {sim.id === 'pitch' && <PitchBlock sim={sim} demo={demo} relay={canAnswer} />}
        {sim.id === 'campaign' && <CampaignBlock sim={sim} relay={canAnswer} />}
        {sim.id === 'funding' && <RankBlock sim={sim} relay={canAnswer} />}
        {!isCandidate && (
          <div className="verdict ok" style={{ marginTop: 22 }}>
            {lastAnswer && lastAnswer.sim === sim.id
              ? `Candidate responded live: ${fmtAnswer(lastAnswer)}`
              : 'You\u2019re watching live. Notice whether they talk through their reasoning — that\u2019s the signal, not the answer.'}
          </div>
        )}
        {isCandidate && real && (
          <div className="session-notes" style={{ marginTop: 18, fontSize: 12.5 }}>
            Your answers stream to the interviewer live — talk your reasoning out loud.
          </div>
        )}
      </div>
    </div>
  )
}

/* ————— Sim: code block ————— */

function CodeBlock() {
  return (
    <div className="code-card">
      <div className="cc-head"><span className="cc-dots"><i /><i /><i /></span> checkout.js</div>
      <pre>
        <span className="k">function</span> <span className="fn">checkout</span>(cart, promo) {'{'}{'\n'}
        {'  '}<span className="k">let</span> total = <span className="n">0</span>;{'\n'}
        {'  '}<span className="k">for</span> (<span className="k">const</span> item <span className="k">of</span> cart) total += item.price;{'\n'}
        {'  '}<span className="k">if</span> (promo) total -= promo.discount;{'\n'}
        {'  '}<span className="k">return</span> {'{'} total: Math.max(<span className="n">0</span>, total) {'}'};{'\n'}
        {'}'}
      </pre>
    </div>
  )
}

/* ————— Sim: multiple choice (with verdict) ————— */

function ChoiceBlock({ sim, relay = false }) {
  const [picked, setPicked] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const chosen = sim.choices.find((c) => c.id === picked)

  return (
    <>
      <div className="choice-list">
        {sim.choices.map((c) => {
          let cls = ''
          if (picked) {
            if (c.id === sim.correct) cls = 'correct'
            else if (c.id === picked) cls = 'wrong'
          }
          return (
            <button key={c.id} className={`choice ${cls} ${picked === c.id ? 'picked' : ''}`}
              disabled={!!picked}
              onClick={() => {
                setPicked(c.id)
                setRevealed(true)
                if (relay) Match.sendSimAnswer({ type: 'choice', sim: sim.id, choice: c.label, correct: c.id === sim.correct })
              }}>
              <span className="c-key">{c.id.toUpperCase()}</span>
              <span className="c-label">{c.label}</span>
            </button>
          )
        })}
      </div>
      {revealed && chosen && (
        <div className={`verdict ${chosen.id === sim.correct ? 'ok' : 'no'}`}>
          {chosen.id === sim.correct ? '✓ On the right track. ' : 'Not quite — but the reasoning matters more than the pick. '}
          {chosen.verdict}
        </div>
      )}
      {revealed && sim.followup && (
        <div className="event-card" style={{ position: 'relative', transform: 'none', left: 'auto', top: 'auto', marginTop: 18, width: '100%' }}>
          <span className="ev-tag">Follow-up — still live</span>
          <p style={{ color: 'var(--text)', fontWeight: 500, marginTop: 8 }}>{sim.followup}</p>
        </div>
      )}
    </>
  )
}

/* ————— Sim: sales pitch ————— */

function PitchBlock({ sim, demo, relay = false }) {
  const [started, setStarted] = useState(false)
  const [left, setLeft] = useState(demo ? 20 : 90)
  const [phase, setPhase] = useState('ready') // ready | pitching | after

  useEffect(() => {
    if (!started) return
    if (left <= 0) {
      setPhase('after')
      if (relay) Match.sendSimAnswer({ type: 'pitch', sim: sim.id, phase: 'after' })
      return
    }
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [started, left, relay, sim.id])

  return (
    <>
      <div className="pitch-card">
        <span className="pc-label">The product — {phase === 'ready' ? 'reveal when you\u2019re ready' : 'revealed'}</span>
        <h3>{sim.product.name}</h3>
        <p>{sim.product.oneLiner}</p>
      </div>
      {phase === 'ready' && (
        <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => {
          setStarted(true)
          setPhase('pitching')
          if (relay) Match.sendSimAnswer({ type: 'pitch', sim: sim.id, phase: 'started' })
        }}>
          Reveal + start the 90-second pitch →
        </button>
      )}
      {phase === 'pitching' && (
        <>
          <div className="pitch-bar"><i style={{ width: `${((demo ? 20 : 90) - left) / (demo ? 20 : 90) * 100}%` }} /></div>
          <p className="mono" style={{ color: 'var(--amber)', fontSize: 13, marginTop: 8 }}>{left}s left — make the first sale, out loud</p>
        </>
      )}
      {phase === 'after' && (
        <div className="event-card" style={{ position: 'relative', transform: 'none', left: 'auto', top: 'auto', marginTop: 20, width: '100%' }}>
          <span className="ev-tag">Objection — live</span>
          <p style={{ color: 'var(--text)', fontWeight: 500, marginTop: 8 }}>{sim.after}</p>
          <p className="text-2" style={{ fontSize: 13, marginTop: 8 }}>Talk your way through it. The interviewer is watching how you recover, not whether you close.</p>
        </div>
      )}
    </>
  )
}

/* ————— Sim: marketing campaign ————— */

const CAMPAIGN_METRICS = {
  signups: 'Qualified signups in 60 days',
  awareness: 'Top-of-mind awareness',
  retention: '30-day activation rate',
}

function CampaignBlock({ sim, relay = false }) {
  const TOTAL = 40
  const [picks, setPicks] = useState({ tiktok: 14, uab: 10, pod: 8, paid: 8 })
  const [metric, setMetric] = useState('signups')
  const [shipped, setShipped] = useState(false)
  const sum = Object.values(picks).reduce((a, b) => a + b, 0)

  const setBudget = (id, v) => {
    const next = { ...picks, [id]: v }
    const diff = v - picks[id]
    if (sum + diff > TOTAL) {
      const over = sum + diff - TOTAL
      for (const k of Object.keys(next)) {
        if (k !== id && next[k] >= over) { next[k] -= over; break }
      }
    }
    setPicks(next)
  }

  return (
    <>
      <div className="channel-grid">
        {sim.channels.map((c) => (
          <div key={c.id} className="channel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="cc-label">{c.label}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--violet)' }}>${picks[c.id]}k</span>
            </div>
            <span className="cc-hint">{c.hint}</span>
            <input type="range" min={0} max={TOTAL} value={picks[c.id]} onChange={(e) => setBudget(c.id, +e.target.value)}
              style={{ width: '100%', marginTop: 10, accentColor: 'var(--violet)' }} />
          </div>
        ))}
      </div>
      <p className="mono" style={{ fontSize: 12.5, color: sum === TOTAL ? 'var(--mint)' : 'var(--amber)', marginTop: 12 }}>{`Budget: $${sum}k / $${TOTAL}k`} {sum !== TOTAL && `— adjust to $${TOTAL}k`}</p>
      <div className="form-item" style={{ marginTop: 16 }}>
        <label>The one metric you&apos;ll defend</label>
        <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value="signups">Qualified signups in 60 days</option>
          <option value="awareness">Top-of-mind awareness</option>
          <option value="retention">30-day activation rate</option>
        </select>
      </div>
      <button className="btn btn-violet" disabled={sum !== TOTAL} onClick={() => {
        setShipped(true)
        if (relay) Match.sendSimAnswer({ type: 'campaign', sim: sim.id, metric: CAMPAIGN_METRICS[metric], budget: TOTAL })
      }}>Ship the campaign →</button>
      {shipped && (
        <div className="verdict ok" style={{ marginTop: 18 }}>
          {`Shipped at $${TOTAL}k, defending `}<strong>{metric.replace(/-/g, ' ')}</strong>. The interviewer will push on why that metric — and on what you&apos;d cut when the investor halves the budget.
        </div>
      )}
    </>
  )
}

/* ————— Sim: business ranking ————— */

function RankBlock({ sim, relay = false }) {
  const [order, setOrder] = useState([])
  const [locked, setLocked] = useState(false)
  const remaining = sim.options.filter((o) => !order.includes(o.id))
  const ranked = order.map((id) => sim.options.find((o) => o.id === id))

  const push = (id) => setOrder((o) => [...o, id])
  const pop = () => setOrder((o) => o.slice(0, -1))

  return (
    <>
      {order.length > 0 && (
        <div className="rank-list">
          {ranked.map((o, i) => (
            <div key={o.id} className="rank-item ranked">
              <span className="r-idx">#{i + 1}</span>
              <div>
                <div className="r-label">{o.label}</div>
                <div className="r-note">{o.note}</div>
              </div>
              <div className="r-ctrl"><button className="rank-btn" onClick={pop}>↑</button></div>
            </div>
          ))}
        </div>
      )}
      {remaining.length > 0 && (
        <div className="rank-list">
          {remaining.map((o) => (
            <div key={o.id} className="rank-item">
              <span className="r-idx">—</span>
              <div>
                <div className="r-label">{o.label}</div>
                <div className="r-note">{o.note}</div>
              </div>
              <div className="r-ctrl"><button className="rank-btn" onClick={() => push(o.id)}>↓</button></div>
            </div>
          ))}
        </div>
      )}
      {order.length === sim.options.length && !locked && (
        <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => {
          setLocked(true)
          if (relay) Match.sendSimAnswer({ type: 'rank', sim: sim.id, ranked: ranked.map((o) => o.label) })
        }}>Lock in the ranking →</button>
      )}
      {locked && (
        <div className="verdict ok" style={{ marginTop: 18 }}>
          Locked: <strong>{ranked[0].label}</strong> stays funded. Now defend the cut — the interviewer is going to argue for the initiative you killed.
        </div>
      )}
    </>
  )
}

/* ————— Whiteboard ————— */

function Whiteboard({ relay = false }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawing = useRef(false)
  const strokes = useRef([])
  const remoteLive = useRef(null) // in-progress stroke from the peer
  const recentStrokes = useRef([]) // last N strokes, for re-sync when the peer's board opens
  const peerDrawTimer = useRef(null)
  const [color, setColor] = useState('#efe8d8')
  const [tool, setTool] = useState('pen')
  const [teammateTimer, setTeammateTimer] = useState(false)
  const [peerDrawing, setPeerDrawing] = useState(false)
  const strokeId = () => Math.random().toString(36).slice(2, 10)

  const replay = (stroke, ctx) => {
    if (!stroke.pts.length) return
    ctx.beginPath()
    ctx.moveTo(stroke.pts[0].x, stroke.pts[0].y)
    stroke.pts.forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  const redraw = () => {
    const c = canvasRef.current
    const ctx = ctxRef.current
    if (!c || !ctx) return
    const rect = c.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    strokes.current.forEach((st) => replay(st, ctx))
    if (remoteLive.current?.pts.length) replay(remoteLive.current, ctx)
  }

  const clearAll = () => {
    strokes.current = []
    remoteLive.current = null
    recentStrokes.current = []
    const c = canvasRef.current
    const ctx = ctxRef.current
    if (c && ctx) {
      const rect = c.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
    }
    if (relay) Match.sendClear()
  }

  /* canvas sizing — replays everything, including the peer's live stroke */
  useEffect(() => {
    const c = canvasRef.current
    const size = () => {
      const rect = c.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = window.devicePixelRatio || 1
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctxRef.current = ctx
      strokes.current.forEach((st) => replay(st, ctx))
      if (remoteLive.current?.pts.length) replay(remoteLive.current, ctx)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  /* real-time cross-tab whiteboard: stream strokes both ways */
  useEffect(() => {
    if (!relay) return
    const offL = Match.on('remote-stroke-live', (pt) => {
      if (!remoteLive.current) remoteLive.current = { color: pt.color, tool: pt.tool, width: pt.width, pts: [] }
      remoteLive.current.pts.push({ x: pt.x, y: pt.y })
      setPeerDrawing(true)
      clearTimeout(peerDrawTimer.current)
      peerDrawTimer.current = setTimeout(() => setPeerDrawing(false), 1500)
      redraw()
    })
    const offS = Match.on('remote-stroke', (st) => {
      if (st.id && strokes.current.some((x) => x.id === st.id)) return // dedupe re-syncs
      strokes.current.push(st)
      recentStrokes.current = [...recentStrokes.current.slice(-14), st]
      remoteLive.current = null
      setPeerDrawing(false)
      redraw()
    })
    const offC = Match.on('remote-clear', () => clearAll())
    const offA = Match.on('remote-wb-ack', () => {
      // peer's board just opened — resend our recent strokes so nothing is lost
      recentStrokes.current.forEach((st) => Match.sendStroke(st))
    })
    Match.sendWbAck() // tell the peer we're ready to receive
    return () => { offL(); offS(); offC(); offA(); clearTimeout(peerDrawTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relay])

  /* demo mode: a simulated teammate sketches after a quiet moment */
  useEffect(() => {
    if (relay) return
    const t = setTimeout(() => {
      const c = canvasRef.current
      const ctx = ctxRef.current
      if (!c || !ctx) return
      const stroke = {
        id: strokeId(), color: '#c4bba9', tool: 'pen', width: 3,
        pts: Array.from({ length: 22 }, (_, i) => ({
          x: 60 + i * 9 + Math.random() * 6,
          y: 40 + Math.sin(i / 3) * 26 + Math.random() * 10,
        })),
      }
      strokes.current.push(stroke)
      recentStrokes.current = [...recentStrokes.current.slice(-14), stroke]
      replay(stroke, ctx)
      setTeammateTimer(true)
    }, 6000)
    return () => clearTimeout(t)
  }, [relay])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const down = (e) => {
    drawing.current = true
    strokes.current.push({ id: strokeId(), color, tool, width: tool === 'eraser' ? 18 : 3, pts: [pos(e)] })
  }

  const move = (e) => {
    if (!drawing.current) return
    const stroke = strokes.current[strokes.current.length - 1]
    stroke.pts.push(pos(e))
    if (relay && stroke.pts.length % 2 === 0) {
      const last = stroke.pts[stroke.pts.length - 1]
      Match.sendStrokeLive({ color: stroke.color, tool: stroke.tool, width: stroke.width, x: last.x, y: last.y })
    }
    redraw()
  }

  const up = () => {
    drawing.current = false
    if (strokes.current.length) {
      const st = strokes.current[strokes.current.length - 1]
      recentStrokes.current = [...recentStrokes.current.slice(-14), st]
      if (relay) Match.sendStroke(st)
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="wb-toolbar">
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-3)', textTransform: 'uppercase' }}>Shared whiteboard</span>
        <div style={{ flex: 1 }} />
        {['#efe8d8', '#c4bba9', '#8a8272', '#e8a33d', '#9db66e'].map((c) => (
          <button key={c} className={`wb-tool ${color === c && tool !== 'eraser' ? 'on' : ''}`}
            onClick={() => { setColor(c); setTool('pen') }}
            style={{ background: c, borderColor: color === c ? 'var(--text)' : 'var(--line)', borderRadius: '50%', width: 26, height: 26 }} />
        ))}
        <button className={`wb-tool ${tool === 'pen' ? 'on' : ''}`} onClick={() => setTool('pen')} title="pen"><Pencil size={14} /></button>
        <button className={`wb-tool ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')} title="eraser"><Eraser size={14} /></button>
        <button className="wb-tool" onClick={clearAll} title="clear"><Trash size={14} /></button>
      </div>
      <div className="wb-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        {(peerDrawing || teammateTimer) && (
          <div style={{ position: 'absolute', left: 14, bottom: 14, fontFamily: 'var(--font-mono)', fontSize: 11, color: peerDrawing ? 'rgba(224,93,74,.9)' : 'rgba(232,163,61,.85)' }}>
            {peerDrawing ? 'peer is drawing…' : 'teammate is sketching an alternative…'}
          </div>
        )}
      </div>
    </div>
  )
}
