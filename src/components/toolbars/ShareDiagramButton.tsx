import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

type SharePermission = 'viewer' | 'editor'

interface ShareDiagramButtonProps {
  diagramId: string
  className?: string
}

export function ShareDiagramButton({ diagramId, className }: ShareDiagramButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [permission, setPermission] = useState<SharePermission>('editor')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  const permissionLabel = useMemo(
    () => (permission === 'editor' ? '可編輯（共創）' : '唯讀檢視'),
    [permission]
  )

  const generateLink = async () => {
    setLoading(true)
    setError('')
    setLink('')

    const { data, error: rpcError } = await supabase.rpc('upsert_diagram_share', {
      p_diagram_id: diagramId,
      p_permission: permission
    })
    setLoading(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.token) {
      setError('分享連結建立失敗')
      return
    }

    const nextLink = `${window.location.origin}/shared/${row.token}`
    setLink(nextLink)
  }

  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? 'rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700'}
        onClick={() => setOpen(true)}
      >
        分享
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">分享圖表</h3>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                onClick={() => setOpen(false)}
              >
                關閉
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">權限</p>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={permission}
                  onChange={(event) => setPermission(event.target.value as SharePermission)}
                >
                  <option value="editor">可編輯（共創）</option>
                  <option value="viewer">唯讀檢視</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">目前：{permissionLabel}</p>
              </div>

              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => void generateLink()}
                disabled={loading}
              >
                {loading ? '產生中…' : '產生分享連結'}
              </button>

              {error && <p className="text-xs text-rose-600">{error}</p>}

              {link && (
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <p className="mb-2 text-xs font-semibold text-slate-500">分享連結</p>
                  <div className="flex items-center gap-2">
                    <input
                      value={link}
                      readOnly
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => void copyLink()}
                    >
                      複製
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
