import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

const shareClientCache = new Map<string, typeof supabase>()

export function getSupabaseClient(shareToken?: string | null) {
  if (!shareToken) return supabase
  const cached = shareClientCache.get(shareToken)
  if (cached) return cached

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        'x-share-token': shareToken
      }
    }
  })
  shareClientCache.set(shareToken, client)
  return client
}
