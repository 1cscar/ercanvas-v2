import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

function toAppUser(user) {
  if (!user) return null

  return {
    id: user.id,
    uid: user.id,
    email: user.email || '',
    displayName:
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'User',
    photoURL: user.user_metadata?.avatar_url || null,
    raw: user,
  }
}

function syncLegacySession(user) {
  if (!user) {
    localStorage.removeItem('er_session')
    return
  }

  try {
    localStorage.setItem('er_session', JSON.stringify({
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
    }))
  } catch (_) {}
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(true)

  let subscription = null
  let initPromise = null

  async function init() {
    if (initPromise) return initPromise

    initPromise = (async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error

      user.value = toAppUser(data.session?.user || null)
      syncLegacySession(user.value)
      loading.value = false

      if (!subscription) {
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
          user.value = toAppUser(session?.user || null)
          syncLegacySession(user.value)
          loading.value = false
        })

        subscription = authListener.subscription
      }
    })()

    return initPromise
  }

  async function loginWithGoogle() {
    const redirectTo = new URL('/auth/callback', window.location.origin).toString()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })

    if (error) throw error
  }

  async function logout() {
    // Tear down the auth listener so it doesn't fire on the sign-out event
    // and can be recreated cleanly on the next login.
    if (subscription) {
      subscription.unsubscribe()
      subscription = null
      initPromise = null
    }

    const { error } = await supabase.auth.signOut()
    if (error) throw error

    user.value = null
    syncLegacySession(null)
  }

  return { user, loading, init, loginWithGoogle, logout }
})
