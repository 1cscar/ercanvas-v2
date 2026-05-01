import { useState } from 'react'
import { Diagram } from '../types'

interface TrashModalProps {
  open: boolean
  diagrams: Diagram[]
  loading?: boolean
  onClose: () => void
  onRestore: (diagramId: string) => Promise<void> | void
  onRestoreAll: () => Promise<void> | void
  onDeleteForever: (diagramId: string) => Promise<void> | void
  onDeleteForeverAll: () => Promise<void> | void
}

const formatDate = (value: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export function TrashModal({
  open,
  diagrams,
  loading = false,
  onClose,
  onRestore,
  onRestoreAll,
  onDeleteForever,
  onDeleteForeverAll
}: TrashModalProps) {
  const [spittingId, setSpittingId] = useState<string | null>(null)

  const handleRestoreClick = async (diagramId: string) => {
    setSpittingId(diagramId)
    window.setTimeout(() => setSpittingId(null), 520)
    await new Promise((resolve) => window.setTimeout(resolve, 220))
    await onRestore(diagramId)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-800">垃圾桶</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-emerald-600 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              disabled={diagrams.length === 0}
              onClick={() => void onRestoreAll()}
            >
              全部復原
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-600 px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={diagrams.length === 0}
              onClick={() => void onDeleteForeverAll()}
            >
              全部永久刪除
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              關閉
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto p-5">
          {loading ? (
            <p className="text-sm text-slate-500">載入中...</p>
          ) : diagrams.length === 0 ? (
            <p className="text-sm text-slate-500">目前沒有已刪除圖表。</p>
          ) : (
            <div className="space-y-3">
              {diagrams.map((diagram) => (
                <div
                  key={diagram.id}
                  className={`trash-row flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 ${spittingId === diagram.id ? 'spit-out' : ''}`}
                >
                  <div>
                    <p className="font-medium text-slate-800">{diagram.name}</p>
                    <p className="text-xs text-slate-500">
                      類型：{diagram.type} ｜刪除時間：{formatDate(diagram.deleted_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-600 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                      onClick={() => void handleRestoreClick(diagram.id)}
                    >
                      復原
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-rose-600 px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => void onDeleteForever(diagram.id)}
                    >
                      永久刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
