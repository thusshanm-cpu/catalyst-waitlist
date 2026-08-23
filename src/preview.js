// ————— Access gate —————
// The deployed (production) waitlist unlocks ONE thing: the demo, for
// people who joined the waitlist (`catalyst.joined` on their device).
// Nothing else leads to the working site on production:
//   • `?preview=1`  — dev only (judge mode, reveals everything).
//   • sign-in/real accounts — dev only.
// Everything below only returns true in dev, except isJoined/markJoined
export const isPreview = () =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === '1'

const JOINED_KEY = 'catalyst.joined'

/** record that this device joined the waitlist (unlocks the demo) */
export const markJoined = () => {
  try {
    localStorage.setItem(JOINED_KEY, '1')
  } catch {
    /* private mode */
  }
}

export const isJoined = () => {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(JOINED_KEY) === '1'
  } catch {
    return false
  }
}

/** demo flows are available to judges (?preview=1, dev) and to people who joined */
export const canDemo = () => isPreview() || isJoined()
