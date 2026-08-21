import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

const StoreContext = createContext(null)

const LS_KEY = 'catalyst.state.v1'

const EMPTY = { user: null, view: 'landing', session: null, history: [], authUser: null }

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota / private mode */
    }
  }, [state])

  const api = useMemo(() => {
    const navigate = (view) => setState((s) => ({ ...s, view }))
    const completeOnboarding = (user, opts = {}) =>
      setState((s) => ({ ...s, user: { ...user, verified: opts.verified !== false }, view: 'dashboard' }))
    const setAuthUser = (authUser) => setState((s) => ({ ...s, authUser }))
    const startSession = (session) => setState((s) => ({ ...s, session, view: 'session' }))
    const updateSession = (patch) =>
      setState((s) => (s.session ? { ...s, session: { ...s.session, ...patch } } : s))
    const endSession = (patch = {}) =>
      setState((s) => {
        if (!s.session) return s
        const closed = { ...s.session, phase: 'ended', ...patch }
        const entry = {
          id: closed.id,
          role: closed.role,
          roleType: closed.roleType,
          counterpart: closed.counterpart?.name ?? 'Anonymous',
          when: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          decision: patch.decision ?? 'skipped',
        }
        return { ...s, session: closed, history: [entry, ...s.history].slice(0, 12), view: 'post' }
      })
    const newSession = () => setState((s) => ({ ...s, session: null, view: 'dashboard' }))
    const reset = () => {
      localStorage.removeItem(LS_KEY)
      setState(EMPTY)
    }
    return { navigate, completeOnboarding, setAuthUser, startSession, updateSession, endSession, newSession, reset }
  }, [])

  const value = useMemo(() => ({ state, api }), [state, api])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
