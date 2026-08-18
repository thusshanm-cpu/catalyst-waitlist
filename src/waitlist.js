// ————— Waitlist —————
// The app is client-side (GitHub Pages, no backend), so signups persist to
// localStorage to keep the prototype working end-to-end. Paste a form backend
// URL below and submissions will also POST there as JSON:
//   { email, name, role, fields, at }
// Works with Formspree, Getform, a serverless function, etc.
export const WAITLIST_ENDPOINT = '' // e.g. 'https://formspree.io/f/xxxxxxx'

const LS_KEY = 'catalyst.waitlist.v1'

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
}

export function loadSignups() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

function persist(signups) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(signups))
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Record a waitlist signup. Returns:
 *   { ok: false, reason: 'exists' | 'error', position } — duplicate or failed
 *   { ok: true, position, mode } — mode is 'local' (no endpoint yet) or 'remote'
 */
export async function joinWaitlist(entry) {
  const email = String(entry.email).trim().toLowerCase()
  const signups = loadSignups()
  const existsAt = signups.findIndex((s) => s.email === email)

  if (existsAt !== -1) {
    return { ok: false, reason: 'exists', position: existsAt + 1 }
  }

  const record = { ...entry, email, at: new Date().toISOString() }

  let mode = 'local'
  if (WAITLIST_ENDPOINT) {
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(record),
      })
      mode = res.ok ? 'remote' : 'local'
    } catch {
      mode = 'local'
    }
  }

  persist([...signups, record])
  return { ok: true, position: signups.length + 1, mode }
}
