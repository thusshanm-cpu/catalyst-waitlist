// ————— Waitlist —————
// The app is client-side (GitHub Pages, no backend), so signups persist to
// localStorage to keep the prototype working end-to-end. Set WAITLIST_ENDPOINT
// to a form backend and submissions will also POST there as form data:
//   email, name, role, fields (comma-joined), at
// Works with Formspree, Getform, Sheet Monkey, Web3Forms, a serverless
// function, etc.
export const WAITLIST_ENDPOINT = 'https://formspree.io/f/xaewlldd'

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
      // Form backends accept cross-origin browser posts and expect a
      // url-encoded body, not JSON. Flatten the fields array to one string.
      const body = new URLSearchParams()
      // Formspree honeypot: bots that auto-fill hidden fields trip this.
      // Real users never see it; the field is sent empty so humans pass.
      body.set('_gotcha', '')
      body.set('email', record.email)
      if (record.name) body.set('name', record.name)
      body.set('role', record.role)
      body.set('fields', (record.fields || []).join(', '))
      body.set('at', record.at)
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      })
      mode = res.ok ? 'remote' : 'local'
    } catch {
      mode = 'local'
    }
  }

  persist([...signups, record])
  return { ok: true, position: signups.length + 1, mode }
}
