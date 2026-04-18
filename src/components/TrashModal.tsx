import { Diagram } from '../types'

interface TrashModalProps {
  open: boolean
  diagrams: Diagram[]
  loading?: boolean
  onClose: () => void
  onRestore: (diagramId: string) => Promise<void> | void
  onDeleteForever: (diagramId: string) => Promise<void> | void
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
  onDeleteForever
}: TrashModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-800">垃圾桶</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            關閉
          </button>
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
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
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
                      onClick={() => onRestore(diagram.id)}
                    >
                      復原
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-rose-600 px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => onDeleteForever(diagram.id)}
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
