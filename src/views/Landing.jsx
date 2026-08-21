import { useEffect, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useStore } from '../store.jsx'
import { useToast } from '../toast.jsx'
import { DEMO_PROFILES } from '../data.js'
import Reveal from '../components/Reveal.jsx'
import Waitlist from '../components/Waitlist.jsx'
import { isPreview, canDemo } from '../preview.js'
import { Check, Zap, Bug, Target, Megaphone, Coins, Fingerprint, Shield, Building, Warning, ArrowUpRight, Handshake } from '../components/icons.jsx'

export default function Landing() {
  const { api } = useStore()
  const { toast } = useToast()
  const reduce = useReducedMotion()
  const preview = isPreview()
  const demo = canDemo() // judges (?preview=1) and people who joined

  /* the hero mock drifts slower than the page — Motion scroll-linked parallax */
  const { scrollY } = useScroll()
  const mockY = useTransform(scrollY, [0, 900], [0, 81])

  const go = (role) => api.navigate('onboarding') /* role picked on the onboarding step 1 */

  /* waitlist segment shortcut: jump to the form with the right role preselected */
  const [waitlistRole, setWaitlistRole] = useState('candidate')
  const joinAs = (role) => {
    setWaitlistRole(role)
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })
  }

  /* judge-mode shortcut: skip onboarding entirely, land verified on the dashboard */
  const instant = (role) => {
    api.completeOnboarding(DEMO_PROFILES[role])
    toast(role === 'candidate' ? 'Demo student verified — welcome to the room' : 'Demo company verified — welcome to the room', '⚡')
  }

  return (
    <div>
      {/* ————— Nav ————— */}
      <nav className="nav">
        <div className="container nav-inner">
          <div className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <svg className="brand-mark" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="9" fill="none" stroke="rgba(255,255,255,.25)" />
              <circle cx="14" cy="16" r="5" fill="#6d7cff" />
              <circle cx="22" cy="10" r="3" fill="#8dd6ff" />
              <circle cx="22" cy="22" r="3" fill="#8c93fb" />
            </svg>
            Catalyst
          </div>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#sims">Simulations</a>
            <a href="#cofounders">For founders</a>
            <a href="#safety">Trust &amp; safety</a>
            <a href="#waitlist">Join the waitlist</a>
          </div>
          <div className="nav-actions">
            {demo ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => go('employer')}>I&apos;m a startup</button>
                <button className="btn btn-primary btn-sm" onClick={() => go('candidate')}>I&apos;m a student</button>
              </>
            ) : (
              <a href="#waitlist" className="btn btn-primary btn-sm">Join the waitlist</a>
            )}
          </div>
        </div>
      </nav>

      {/* ————— Hero ————— */}
      <header className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <Reveal><span className="eyebrow">Live talent discovery</span></Reveal>
            <Reveal delay={90}>
              <h1 className="display display-xl">
                <span className="hero-line"><motion.span className="hero-line-in" initial={reduce ? false : { y: '112%' }} animate={{ y: 0 }} transition={{ delay: 0.12, duration: 0.85, ease: [0.16, 1, 0.3, 1] }}>The resume is the</motion.span></span>
                <span className="hero-line"><motion.span className="hero-line-in" initial={reduce ? false : { y: '112%' }} animate={{ y: 0 }} transition={{ delay: 0.3, duration: 0.85, ease: [0.16, 1, 0.3, 1] }}><em>last thing</em> we look at.</motion.span></span>
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="hero-sub">
                Blind, ten-minute video interviews and live startup simulations — hiring runs on how
                you think under pressure, not where you&apos;ve worked.
              </p>
            </Reveal>
            <Reveal delay={270}>
              <div className="hero-cta">
                <a href="#waitlist" className="btn btn-primary btn-lg">Join the waitlist</a>
                {demo && <button className="btn btn-violet btn-lg" onClick={() => go('candidate')}>Try the demo</button>}
              </div>
              {demo && (
                <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => instant('candidate')}><Zap size={13} /> Instant demo · student</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => instant('employer')}><Zap size={13} /> Instant demo · startup</button>
                </div>
              )}
              {demo && <div className="hero-note"><span className="check"><Check size={13} /></span> {preview ? 'Preview mode — demo flows enabled' : 'You\u2019re in — demo unlocked'}</div>}
            </Reveal>
          </div>

          <motion.div className="hero-mock-par" style={{ y: mockY }}><Reveal delay={150}><LiveMock /></Reveal></motion.div>
        </div>

        <div className="container">
          <div className="hero-stats">
            <div className="stat"><div className="num">10<em>:</em>00</div><div className="lbl">one session, start to finish</div></div>
            <div className="stat"><div className="num">100<em>%</em></div><div className="lbl">accounts manually verified first</div></div>
            <div className="stat"><div className="num">0</div><div className="lbl">advance notice. no canned answers</div></div>
          </div>
        </div>
      </header>

      {/* ————— Signal ticker ————— */}
      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <div className="ticker-group" key={copy}>
              {['Potential before credentials', 'Live talent discovery', 'Ten minutes. Unscripted.', 'Verified in, verified out', 'Blind matches only'].map((t) => (
                <span key={t}><i>●</i>{t}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ————— How it works (heading pins while the rows scroll past) ————— */}
      <section className="section" id="how">
        <div className="container how-grid">
          <div className="how-head">
            <h2 className="display display-lg">Four moves, ten minutes.</h2>
            <p>No resume review, no phone screens, no waiting weeks. Every session follows the same honest loop.</p>
          </div>
          <div className="index-list">
            {[
              ['01', 'Verify', 'Every account is reviewed by a human — government ID, face match, education, and a real company behind every employer.'],
              ['02', 'Match blind', 'You pick your field, we pick the room. You know the role — never the company. No name bias in the first round.'],
              ['03', 'Interview live', 'A ten-minute video session. The employer sets the scene, then it\u2019s unscripted — including on-the-spot startup simulations.'],
              ['04', 'Resume at match', 'The moment you match, the startup receives your verified resume — then evaluates how you think, live, before unlocking your full profile.'],
            ].map(([n, t, b], i) => (
              <Reveal as="div" className="index-row" key={t} delay={i * 70}>
                <span className="index-num">{n}</span>
                <div className="index-main">
                  <div className="index-title">{t}</div>
                  <p className="index-body">{b}</p>
                </div>
                <span className="index-arrow"><ArrowUpRight size={16} /></span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ————— Startup Simulation Mode ————— */}
      <section className="section" id="sims">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Startup Simulation Mode</span>
            <h2 className="display display-lg">Interviews that feel like work.</h2>
            <p>
              Employers can replace behaviour questions with live scenarios tailored to the role.
              And mid-session, they can change the rules — an upset customer, a teammate who
              disagrees, an investor who moves the deadline. That&apos;s the point.
            </p>
          </div>
          <div className="sim-bento">
            {[
              [<Bug size={26} key="i" />, 'Debug a live bug', 'Software', 'A checkout handler that zeroes out totals "sometimes". Find it, fix it, defend it — out loud, on the clock.'],
              [<Target size={22} key="i" />, 'Sell the unknown', 'Sales', 'A product neither of you has heard of. Ninety seconds to make the first sale. No notes.'],
              [<Megaphone size={22} key="i" />, 'Launch blind', 'Marketing', '$40k, no brand awareness, one month. Build the campaign, split the budget, defend one metric.'],
              [<Coins size={22} key="i" />, 'The funding cut', 'Business', 'Funding dies in 30 days. Three initiatives, one budget. Rank them, then argue for what you cut.'],
            ].map(([icon, title, field, body], i) => (
              <Reveal as="div" className={`sim-card ${i === 0 ? 'sim-feature' : ''}`} key={title} dir={i === 0 ? 'zoom' : 'up'} delay={(i % 2) * 70}>
                <div className="sim-icon">{icon}</div>
                <div>
                  <span className="kicker">{field}</span>
                  <div className="title">{title}</div>
                  <p className="body">{body}</p>
                  <div className="tag-row">
                    <span className="sim-tag">LIVE</span>
                    <span className="sim-tag">90s–2m</span>
                    <span className="sim-tag">Unexpected twists</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ————— Collaboration ————— */}
      <section className="section" id="collab">
        <div className="container cols-2">
          <Reveal>
            <h3 className="display display-md" style={{ margin: '14px 0 12px' }}>
              Stop talking about teamwork. Show it.
            </h3>
            <p className="muted" style={{ fontSize: '15px' }}>
              For collaborative roles, sessions run on a shared whiteboard. Candidates and
              employers sketch, rank, and build together in real time — the way they&apos;d
              actually work, not the way they&apos;d rehearse.
            </p>
            <div className="consent-box" style={{ borderStyle: 'solid' }}>
              {['Shared canvas, design crits, and technical scratch space', 'Employer and candidate draw on the same board', 'Optional — never forced into a session'].map((t) => (
                <div className="row" key={t}><span className="tick"><Check size={13} /></span>{t}</div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={120} dir="right"><CollabMock /></Reveal>
        </div>
      </section>

      {/* ————— Cofounder matching ————— */}
      <section className="section" id="cofounders">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">For founders</span>
            <h2 className="display display-lg">Don&apos;t build alone.</h2>
            <p>Find a cofounder the way you&apos;d hire one — by working together, not by reading profiles. Blind, ten-minute sessions with verified builders who fill the gap in your team.</p>
          </div>
          <Reveal className="band">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 44, alignItems: 'center' }}>
              <div>
                <h3>Startups start with the right room.</h3>
                <p>Skip the coffee-chat dating. Catalyst matches founders for a real working session — then you decide if there&apos;s a company in it.</p>
                <div style={{ marginTop: 22 }}>
                  <button className="btn btn-primary" onClick={() => joinAs('founder')}>Find a cofounder</button>
                </div>
              </div>
              <div className="safety-grid">
                {[
                  [<Shield size={18} key="i" />, 'Verified founders', 'Every founder is ID-checked before they enter a room.'],
                  [<Handshake size={18} key="i" />, 'Work, not coffee', 'A ten-minute working session shows if you can actually build together.'],
                  [<Target size={18} key="i" />, 'Matched on the gap', 'Technical, design, growth — matched to what your team is missing.'],
                  [<Building size={18} key="i" />, 'Ready to start', 'Founders ready to commit, not people window-shopping.'],
                ].map(([icon, t, b], i) => (
                  <Reveal as="div" className="safety-tile" key={t} dir="zoom" delay={i * 70}>
                    <span className="st-icon">{icon}</span>
                    <strong>{t}</strong>
                    <span>{b}</span>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ————— Trust & safety ————— */}
      <section className="section" id="safety">
        <div className="container">
          <Reveal className="band">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 44, alignItems: 'center' }}>
              <div>
                <h3>Verified in, verified out.</h3>
                <p>A hiring room only works if every person in it is real. Catalyst layers verification at every step.</p>
              </div>
              <div className="safety-grid">
                {[
                  [<Fingerprint size={18} key="i" />, 'Government ID + facial match', 'Identity is checked against a live face scan, not a selfie upload.'],
                  [<Shield size={18} key="i" />, 'Manual review on every account', 'A human reviews each candidate and each company before approval.'],
                  [<Building size={18} key="i" />, 'Employer authorization', 'Startups prove they exist and that the recruiter can actually hire.'],
                  [<Warning size={18} key="i" />, 'Moderation & reporting', 'Impersonation, harassment, or misconduct ends in suspension — fast.'],
                ].map(([icon, t, b], i) => (
                  <Reveal as="div" className="safety-tile" key={t} dir="zoom" delay={i * 70}>
                    <span className="st-icon">{icon}</span>
                    <strong>{t}</strong>
                    <span>{b}</span>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal className="band" delay={100} style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 44, alignItems: 'center' }}>
              <div>
                <h3>AI assists. It never decides.</h3>
                <p>
                  With both participants&apos; explicit consent, sessions can be recorded and
                  analyzed to produce structured summaries — communication, adaptability,
                  collaboration — that support the human decision. Decline, and you get the same
                  interview, with nothing recorded.
                </p>
              </div>
              <div className="consent-box" style={{ marginTop: 0 }}>
                {['Clear consent form before you ever join a session', 'Recording & AI analysis are always opt-in, per session', 'AI writes observations, never verdicts', 'Withdraw consent anytime the law allows'].map((t) => (
                  <div className="row" key={t}><span className="tick"><Check size={13} /></span>{t}</div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ————— Demo reel — the whole flow, self-playing ————— */}
      <section className="section" id="demo">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Watch it run</span>
            <h2 className="display display-lg">The whole demo, in sixty seconds.</h2>
            <p>One loop, straight through the product — match, interview, whiteboard, simulation, decide. Press play.</p>
          </div>
          <Reveal dir="zoom"><DemoReel /></Reveal>
        </div>
      </section>

      {/* ————— Waitlist ————— */}
      <section className="section" id="waitlist">
        <div className="container">
          <div className="section-head center" style={{ marginBottom: 30 }}>
            <span className="eyebrow center">Early access</span>
            <h2 className="display display-lg">Potential doesn&apos;t wait for an opening.</h2>
            <p>Be first in the room. Join the waitlist and we&apos;ll email you the moment your cohort opens — one email, no spam.</p>
          </div>
          <Reveal dir="zoom"><Waitlist key={waitlistRole} initialRole={waitlistRole} /></Reveal>
        </div>
      </section>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="brand" style={{ cursor: 'default' }}>Catalyst</div>
          <div className="small">Early beta — the waitlist, live matching, and video sessions are real. Verification, hiring, and AI summaries are simulated until launch.</div>
        </div>
      </footer>
    </div>
  )
}

/* ————— Demo reel — a self-playing walkthrough of the whole flow ————— */

const REEL_STEPS = [
  ['Radar match', 'Your field, never the company.'],
  ['Live interview', 'The employer sets the scene, then it\u2019s unscripted.'],
  ['Shared whiteboard', 'Sketch, rank, and build together in real time.'],
  ['Startup simulation', 'Adapt when the rules change mid-session.'],
  ['Decide & learn', 'Continue, follow up, or read the AI summary.'],
]

function DemoReel() {
  const reduce = useReducedMotion()
  const [playing, setPlaying] = useState(!reduce)
  /* scene 2 shows a real ticking timer, frozen while paused */
  const [secs, setSecs] = useState(9 * 60 + 41)
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setSecs((s) => (s <= 1 ? 9 * 60 + 41 : s - 1)), 1000)
    return () => clearInterval(id)
  }, [playing])
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  if (reduce) {
    /* reduced motion: a static first frame, controls still explain the loop */
    return (
      <div className="reel-frame">
        <div className="reel-chrome">
          <span className="rc-dots"><i /><i /><i /></span>
          <span className="rc-url">catalyst.live — live demo</span>
          <span className="rc-tag">LOOP · 60s</span>
        </div>
        <div className="reel-stage"><ReelScene1 /></div>
        <div className="reel-bar"><span className="rb-cap">Radar match — your field, never the company.</span></div>
      </div>
    )
  }

  return (
    <div className={`reel-frame ${playing ? '' : 'paused'}`}>
      <div className="reel-chrome">
        <span className="rc-dots"><i /><i /><i /></span>
        <span className="rc-url">catalyst.live — live demo</span>
        <button className="rc-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause demo' : 'Play demo'}>
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className="rc-tag">LOOP · 60s</span>
      </div>
      <div className="reel-stage" onClick={() => setPlaying((p) => !p)}>
        <div className="reel-scene rs-1"><ReelScene1 /></div>
        <div className="reel-scene rs-2"><ReelScene2 mm={mm} ss={ss} /></div>
        <div className="reel-scene rs-3"><ReelScene3 /></div>
        <div className="reel-scene rs-4"><ReelScene4 /></div>
        <div className="reel-scene rs-5"><ReelScene5 /></div>
        <div className={`reel-play-hint ${playing ? 'on' : ''}`}>{playing ? '❚❚ tap to pause' : '▶ tap to play'}</div>
      </div>
      <div className="reel-bar">
        <div className="reel-progress"><span className="rp-fill" /></div>
        <div className="reel-dots">
          {REEL_STEPS.map(([t], i) => (
            <span key={t} className={`reel-dot rd-${i + 1}`} aria-label={t} />
          ))}
        </div>
        <div className="reel-captions">
          {REEL_STEPS.map(([t, s], i) => (
            <span key={t} className={`reel-caption rc-${i + 1}`}><b>{t}</b> · {s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <path d="M2.5 1.5v9l7-4.5z" fill="currentColor" />
    </svg>
  )
}
function PauseGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <rect x="2" y="1.5" width="2.8" height="9" fill="currentColor" />
      <rect x="7.2" y="1.5" width="2.8" height="9" fill="currentColor" />
    </svg>
  )
}

/* scene 1 — matchmaking radar */
function ReelScene1() {
  return (
    <div className="reel-mid">
      <div className="rr-rings">
        <div className="rr-ring" /><div className="rr-ring" /><div className="rr-ring" />
        <div className="rr-core" />
        <div className="rr-sweep" />
      </div>
      <div className="reel-mid-copy">
        <h4>Finding your blind match</h4>
        <p>They see the role: <b>Software Engineering</b>. Nothing else about you.</p>
        <div className="reel-log">
          <span>scanning verified room · field: software</span>
          <span>secure link established</span>
          <span className="ok">MATCHED — role only · identity hidden</span>
        </div>
      </div>
      <span className="reel-chip chip-in">✓ VERIFIED BOTH SIDES</span>
    </div>
  )
}

/* scene 2 — live session */
function ReelScene2({ mm, ss }) {
  return (
    <div className="reel-live">
      <div className="rl-tile a"><span className="mono-tile">VS</span><span className="rl-tag">Verified startup · Hiring Software Engineering</span></div>
      <div className="rl-tile b"><span className="mono-tile you">YOU</span><span className="rl-tag you">You · camera on</span></div>
      <div className="rl-top">
        <span className="live-dot" /><span className="rl-live">LIVE</span>
        <span className="rl-timer mono">{mm}:{ss} left</span>
      </div>
      <div className="rl-scenario pop">
        <span className="rl-z">⚡</span>
        <div>
          <b>Scenario incoming — the investor just changed the requirements.</b>
          <span>The founder wants to see how you adapt, live.</span>
        </div>
        <span className="rl-adapt">ADAPT →</span>
      </div>
    </div>
  )
}

/* scene 3 — shared whiteboard */
function ReelScene3() {
  return (
    <div className="reel-board">
      <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
        <line className="draw d1" x1="40" y1="150" x2="150" y2="90" />
        <line className="draw d2" x1="150" y1="90" x2="240" y2="120" />
        <rect className="draw d3" x="120" y="110" width="70" height="50" />
        <circle className="draw d4" cx="280" cy="100" r="26" />
        <text x="24" y="32" className="rb-label">retention flow — sketch</text>
        <text x="150" y="185" className="rb-label dim">drop-off here?</text>
      </svg>
      <div className="rb-peer">
        <span className="rb-cursor" /><span>teammate is drawing…</span>
      </div>
      <div className="rb-toolbar">
        {['✏️', '▭', '◯', '🧹'].map((t, i) => <span key={i} className={`rb-tool ${i === 0 ? 'active' : ''}`}>{t}</span>)}
      </div>
    </div>
  )
}

/* scene 4 — startup simulation */
function ReelScene4() {
  return (
    <div className="reel-sim">
      <div className="rsim-head">
        <span className="rsim-tag">SIMULATION · DEBUGGING · 90s</span>
        <span className="rsim-timer mono">01:27</span>
      </div>
      <div className="rsim-body">
        <p className="rsim-task">Checkout totals zero out &quot;sometimes&quot;. Find the bug.</p>
        <pre className="rsim-code mono">{`const total = items
  .map((i) => i.price * i.qty)
  .reduce((a, b) => a + b, 0)`}
        </pre>
        <div className="rsim-answer pop">
          <b>Found it</b> — the map callback returns a string. <span className="mono">+Number()</span>
        </div>
      </div>
      <span className="reel-chip chip-in ok">✓ FIX SUBMITTED · 38s left</span>
    </div>
  )
}

/* scene 5 — decide + AI summary */
function ReelScene5() {
  return (
    <div className="reel-decide">
      <div className="rdec-cards">
        {['Keep talking', 'Request follow-up', 'Save connection', 'Skip to next match'].map((t, i) => (
          <span key={t} className={`rdec-card c${i + 1}`}>{t}</span>
        ))}
      </div>
      <div className="rdec-ai pop">
        <span className="rdec-ai-tag">AI SUMMARY · CONSENT ON</span>
        <div className="rdec-ai-row"><span>Communication</span><i><b style={{ width: '88%' }} /></i></div>
        <div className="rdec-ai-row"><span>Adaptability</span><i><b style={{ width: '76%' }} /></i></div>
        <div className="rdec-ai-row"><span>Problem-solving</span><i><b style={{ width: '92%' }} /></i></div>
      </div>
    </div>
  )
}

/* ————— The hero signature: a live session, in miniature ————— */

function LiveMock() {
  /* the hero mock is a live session — the timer really ticks, the ring really drains */
  const TOTAL = 4 * 60 + 12
  const [secs, setSecs] = useState(TOTAL)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setSecs((s) => (s <= 1 ? TOTAL : s - 1)), 1000)
    return () => clearInterval(id)
  }, [])
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  const frac = secs / TOTAL

  return (
    <div className="session-mock" aria-hidden>
      <div className="mock-bar">
        <span className="live-dot" />
        <span className="mock-live">LIVE</span>
        <span className="mock-timer">software intern · {mm}:{ss}</span>
      </div>
      <div className="mock-stage">
        <div className="mock-tile a">
          <div className="tile-art"><div className="mono-tile"><span>VS</span></div></div>
          <div className="tile-tag">
            <span>Verified startup</span>
            <span className="small">· hiring software</span>
          </div>
        </div>
        <div className="mock-tile b">
          <div className="tile-art"><div className="mono-tile you"><span>YOU</span></div></div>
          <div className="tile-tag you"><span>You</span></div>
        </div>
        <div className="mock-ring">
          <svg viewBox="0 0 100 100">
            <circle className="ring-bg" cx="50" cy="50" r="46" />
            <circle className="ring-fg" cx="50" cy="50" r="46" style={{ strokeDashoffset: 100 * (1 - frac) }} />
          </svg>
          <div className="num">{mm}:{ss}</div>
        </div>
        <span className="mock-phase">unscripted</span>
      </div>
      <div className="mock-scenario">
        <div className="icon"><Zap size={16} /></div>
        <div>
          <div className="t">Scenario incoming — the investor just changed the requirements.</div>
          <div className="s">The founder wants to see how you adapt, live.</div>
        </div>
        <span className="cta">ADAPT →</span>
      </div>
    </div>
  )
}

/* ————— The whiteboard collaboration preview ————— */

function CollabMock() {
  return (
    <div className="session-mock">
      <div className="mock-bar">
        <span className="live-dot" />
        <span className="mock-live">COLLAB</span>
        <span className="mock-timer">whiteboard · 02:41</span>
      </div>
      <div style={{ height: 260, background: '#000000', position: 'relative' }}>
        <svg viewBox="0 0 400 260" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <line x1="60" y1="200" x2="220" y2="120" stroke="rgba(109,124,255,.7)" strokeWidth="3" strokeLinecap="round" />
          <line x1="220" y1="120" x2="330" y2="160" stroke="rgba(210,153,34,.8)" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 5" />
          <rect x="150" y="150" width="70" height="50" fill="none" stroke="rgba(109,124,255,.6)" strokeWidth="2" />
          <circle cx="330" cy="160" r="6" fill="rgba(210,153,34,.9)" />
          <text x="30" y="40" fill="rgba(255,255,255,.45)" fontSize="12" fontFamily="IBM Plex Mono, monospace">retention flow — sketch</text>
          <text x="60" y="212" fill="rgba(255,255,255,.35)" fontSize="11" fontFamily="IBM Plex Mono, monospace">drop-off here?</text>
        </svg>
        <div style={{ position: 'absolute', left: 14, bottom: 12, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>teammate is drawing…</div>
      </div>
    </div>
  )
}
