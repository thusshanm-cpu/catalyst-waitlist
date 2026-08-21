// ————— Access gate —————
// Public visitors see only the landing page + waitlist. Two things unlock
// the demo flows:
//   • `?preview=1`  — judge/dev mode, reveals everything.
//   • a waitlist signup — "you're in, try the demo" (stored per device).
// Anything else forces the landing page.
export const isPreview = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === '1'

const JOINED_KEY = 'catalyst.joined'

/** record that this device joined the waitlist (unlocks the demo) */
export const markJoined = () => {
  try {
    localStorage.setItem(JOINED_KEY, '1')
  } catch {
    /* private mode — the ?preview=1 path still works */
  }
}

export const isJoined = () => {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(JOINED_KEY) === '1'
  } catch {
    return false
  }
}

/** demo flows are available to judges and to people who joined */
export const canDemo = () => isPreview() || isJoined()
