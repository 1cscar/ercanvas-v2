import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface ResolvedShare {
  diagram_id: string
  diagram_type: 'er' | 'logical' | 'physical'
  permission: 'viewer' | 'editor'
  name: string
}

export default function SharedLinkRedirect() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setError('分享連結無效')
      return
    }

    void (async () => {
      const { data, error: rpcError } = await supabase.rpc('resolve_diagram_share', {
        p_token: token
      })

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      const row = (Array.isArray(data) ? data[0] : data) as ResolvedShare | undefined
      if (!row?.diagram_id || !row?.diagram_type) {
        setError('分享連結不存在或已失效')
        return
      }

      navigate(
        `/diagram/${row.diagram_type}/${row.diagram_id}?permission=${row.permission}&shareToken=${token}`,
        { replace: true }
      )
    })()
  }, [navigate, token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        {error ? (
          <>
            <h1 className="mb-2 text-lg font-bold text-slate-800">無法開啟分享</h1>
            <p className="text-sm text-rose-600">{error}</p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-lg font-bold text-slate-800">載入分享圖表中…</h1>
            <p className="text-sm text-slate-500">請稍候</p>
          </>
        )}
      </div>
    </main>
  )
}
