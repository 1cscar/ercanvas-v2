import { useState } from 'react'
import type { LogicalTable } from '../../types'
import {
  downloadPdf,
  exportElementToPdf,
  geminiTablesToLogicalTables,
  normalizeLogicalDiagramByGeminiPDF,
  type GeminiNormalizationResult
} from '../../lib/GeminiNormalizationService'

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; step: string }
  | { kind: 'preview'; result: GeminiNormalizationResult; logicalTables: LogicalTable[] }
  | { kind: 'error'; message: string }

interface GeminiNormalizeModalProps {
  open: boolean
  tables: LogicalTable[]
  diagramId: string
  exportElement: HTMLElement | null
  onClose: () => void
  onConfirmApply: (tables: LogicalTable[]) => void
}

export function GeminiNormalizeModal({
  open,
  tables,
  diagramId,
  exportElement,
  onClose,
  onConfirmApply
}: GeminiNormalizeModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const handleClose = () => {
    setPhase({ kind: 'idle' })
    onClose()
  }

  const handleStart = async () => {
    if (!exportElement) {
      setPhase({ kind: 'error', message: '找不到可輸出的畫布區塊，請重新整理後再試。' })
      return
    }

    try {
      setPhase({ kind: 'running', step: '匯出當前邏輯圖為 PDF…' })
      const { blob, base64 } = await exportElementToPdf(exportElement)
      downloadPdf(blob, 'logical-diagram-export.pdf')

      setPhase({ kind: 'running', step: '將 PDF 送至 Gemini 分析並正規化…' })
      const result = await normalizeLogicalDiagramByGeminiPDF(base64, tables)
      const logicalTables = geminiTablesToLogicalTables(result.normalizedTables, diagramId)
      setPhase({ kind: 'preview', result, logicalTables })
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">PDF + Gemini 正規化（繞過本機自動流程）</h2>
            <p className="text-xs text-slate-500">流程：匯出 PDF → 送 Gemini → 依回傳結果建立正規化表格</p>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5 text-sm">
          {phase.kind === 'idle' && (
            <div className="space-y-3 text-xs text-slate-700">
              <p>將執行以下步驟：</p>
              <ol className="space-y-1.5 pl-4 text-slate-600">
                <li className="list-decimal">把畫布輸出為 PDF 檔（同時下載到本機）</li>
                <li className="list-decimal">用外接 Gemini 讀取 PDF 並輸出正規化建議</li>
                <li className="list-decimal">將 Gemini 建議轉成可建立的邏輯資料表</li>
              </ol>
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-700">
                需要設定環境變數：<code>VITE_GEMINI_API_KEY</code>（可選：<code>VITE_GEMINI_MODEL</code>）
              </p>
            </div>
          )}

          {phase.kind === 'running' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
              <p className="text-sm text-slate-600">{phase.step}</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <p className="font-semibold">處理失敗</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans">{phase.message}</pre>
            </div>
          )}

          {phase.kind === 'preview' && (
            <div className="space-y-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p>領域判斷：<strong>{phase.result.domain}</strong></p>
                <p>Gemini 建議資料表：<strong>{phase.logicalTables.length}</strong> 張</p>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="mb-2 font-semibold">正規化後表格預覽</p>
                <div className="space-y-2">
                  {phase.logicalTables.map((table) => (
                    <div key={table.id} className="rounded border border-slate-200 bg-white px-3 py-2">
                      <p className="font-semibold text-slate-800">{table.name}</p>
                      <p className="mt-0.5 text-slate-500">
                        {table.fields.map((field) => field.name).join('、')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {phase.result.notes.length > 0 && (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="mb-2 font-semibold">Gemini 補充說明</p>
                  <ul className="space-y-1 list-disc pl-4">
                    {phase.result.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={handleClose}
          >
            取消
          </button>

          <div className="flex gap-2">
            {(phase.kind === 'idle' || phase.kind === 'error') && (
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                onClick={() => void handleStart()}
              >
                {phase.kind === 'error' ? '重試' : '開始分析'}
              </button>
            )}

            {phase.kind === 'preview' && (
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => onConfirmApply(phase.logicalTables)}
              >
                建立正規化實體圖
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
