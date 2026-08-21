// ————————————————————————————————————————————————————————————
// Auth — real accounts via Supabase Auth (email + password).
// Works from the client with the publishable key; email confirmation
// is on by default, so a new signup gets a confirmation email.
// ————————————————————————————————————————————————————————————

import { supabase } from './supabase.js'

/** subscribe to auth changes; returns an unsubscribe function */
export const onAuthChange = (cb) => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user || null))
  return () => data.subscription.unsubscribe()
}

/** the current signed-in user, or null */
export async function getAuthUser() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user || null
}

/**
 * Sign up. Returns { user, needsConfirm, error }.
 * `needsConfirm` is true when the project requires email confirmation
 * (default) — tell the user to check their inbox, then sign in.
 */
export async function signUp({ email, password }) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  const hasSession = !!data?.session
  return { user: data?.user || null, needsConfirm: !hasSession, error }
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { user: data?.user || null, error }
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut()
  return error
}
