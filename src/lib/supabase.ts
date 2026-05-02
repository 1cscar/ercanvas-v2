/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

const missingSupabaseMessage = 'Missing Supabase env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'

function createMissingQueryBuilder(message: string) {
  const rejected = Promise.resolve({
    data: null,
    error: { message }
  })

  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return rejected.then.bind(rejected)
        if (prop === 'catch') return rejected.catch.bind(rejected)
        if (prop === 'finally') return rejected.finally.bind(rejected)
        return (..._args: unknown[]) => builder
      }
    }
  )

  return builder
}

function createMissingSupabaseClient(message: string) {
  const queryBuilder = () => createMissingQueryBuilder(message)

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: (_callback: unknown) => ({
        data: { subscription: { unsubscribe: () => undefined } },
        error: null
      }),
      signInWithOAuth: async () => ({ data: null, error: { message } }),
      signInWithOtp: async () => ({ data: null, error: { message } }),
      signOut: async () => ({ error: { message } })
    },
    from: queryBuilder,
    rpc: async () => ({ data: null, error: { message } })
  } as unknown as SupabaseClient
}

export const supabase: SupabaseClient = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createMissingSupabaseClient(missingSupabaseMessage)

const shareClientCache = new Map<string, SupabaseClient>()

export function getSupabaseClient(shareToken?: string | null): SupabaseClient {
  if (!shareToken) return supabase
  const cached = shareClientCache.get(shareToken)
  if (cached) return cached

  const client = hasSupabaseConfig
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            'x-share-token': shareToken
          }
        }
      })
    : createMissingSupabaseClient(missingSupabaseMessage)

  shareClientCache.set(shareToken, client)
  return client
}
