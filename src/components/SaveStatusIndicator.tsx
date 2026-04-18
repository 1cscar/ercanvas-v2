import { SaveStatus } from '../store/saveStatus'

interface SaveStatusIndicatorProps {
  status: SaveStatus
  onRetry?: () => void
}

const statusTextMap: Record<SaveStatus, string> = {
  idle: '未儲存',
  saving: '儲存中…',
  saved: '已儲存 ✓',
  error: '儲存失敗 ✗'
}

const statusClassMap: Record<SaveStatus, string> = {
  idle: 'bg-slate-100 text-slate-600',
  saving: 'bg-amber-100 text-amber-700',
  saved: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700'
}

export function SaveStatusIndicator({ status, onRetry }: SaveStatusIndicatorProps) {
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-20">
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-xs font-medium ${statusClassMap[status]}`}
        onClick={() => status === 'error' && onRetry?.()}
        disabled={status !== 'error'}
      >
        {status === 'saving' && <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />}
        <span>{statusTextMap[status]}</span>
      </button>
    </div>
  )
}
