import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { StoreProvider, useStore } from './store.jsx'
import { ToastProvider } from './toast.jsx'
import { isPreview } from './preview.js'
import Landing from './views/Landing.jsx'
import Onboarding from './views/Onboarding.jsx'
import Dashboard from './views/Dashboard.jsx'
import Session from './views/Session.jsx'
import PostSession from './views/PostSession.jsx'
import Profile from './views/Profile.jsx'

function Router() {
  const { state } = useStore()
  if (!isPreview()) return <Landing /> // public: never past the waitlist
  switch (state.view) {
    case 'onboarding':
      return <Onboarding />
    case 'dashboard':
      return <Dashboard />
    case 'session':
      return <Session />
    case 'post':
      return <PostSession />
    case 'profile':
      return <Profile />
    default:
      return <Landing />
  }
}

/* Thin ember reading bar that fills as you scroll — Motion spring, not manual rAF. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 })
  const opacity = useTransform(scrollYProgress, [0, 0.02], [0, 1])
  return <motion.div className="scroll-progress" style={{ scaleX, opacity }} aria-hidden />
}

/* Soft ember glow that trails the cursor — Motion motion-values + springs. */
function CursorGlow() {
  const reduce = useReducedMotion()
  const mx = useMotionValue(-600)
  const my = useMotionValue(-600)
  const x = useSpring(mx, { stiffness: 110, damping: 18, mass: 0.5 })
  const y = useSpring(my, { stiffness: 110, damping: 18, mass: 0.5 })
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (reduce) return
    const onMove = (e) => {
      mx.set(e.clientX)
      my.set(e.clientY)
      setOn(true)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [mx, my, reduce])

  return <motion.div className="cursor-glow" style={{ x, y, opacity: on ? 1 : 0 }} aria-hidden />
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <ScrollProgress />
        <div className="page-glow" />
        <div className="bg-sweep" aria-hidden />
        <CursorGlow />
        <div className="app">
          <Router />
        </div>
      </ToastProvider>
    </StoreProvider>
  )
}
