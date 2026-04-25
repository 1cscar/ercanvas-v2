import { useCallback, useRef, useState } from 'react'
import { ERVisionResult, LogicalVisionResult, parseERDiagramImage, parseLogicalDiagramImage } from '../lib/VisionService'

interface ERProps {
  mode: 'er'
  onImport: (result: ERVisionResult) => boolean | void
  onClose: () => void
}

interface LogicalProps {
  mode: 'logical'
  onImport: (result: LogicalVisionResult) => boolean | void
  onClose: () => void
}

type Props = ERProps | LogicalProps
type Phase = 'idle' | 'analyzing' | 'done' | 'error'

export function ImageImportModal(props: Props) {
  const { mode, onClose } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ERVisionResult | LogicalVisionResult | null>(null)

  const analyze = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('請上傳圖片檔案（PNG、JPG 等）')
      setPhase('error')
      return
    }
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target?.result as string
      setPreviewUrl(base64)
      setPhase('analyzing')
      setErrorMsg('')
      try {
        const parsed = mode === 'er'
          ? await parseERDiagramImage(base64)
          : await parseLogicalDiagramImage(base64)
        setResult(parsed)
        setPhase('done')
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '解析失敗')
        setPhase('error')
      }
    }
    reader.readAsDataURL(file)
  }, [mode])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void analyze(file)
  }, [analyze])

  const handleConfirm = () => {
    if (!result) return
    const ok = mode === 'er'
      ? (props as ERProps).onImport(result as ERVisionResult)
      : (props as LogicalProps).onImport(result as LogicalVisionResult)
    if (ok === false) return
    onClose()
  }

  const modeLabel = mode === 'er' ? 'ER 圖' : '邏輯圖'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">圖片識別匯入 — {modeLabel}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {phase === 'idle' && (
          <>
            <div
              className="cursor-pointer rounded-lg border-2 border-dashed border-slate-300 p-10 text-center hover:border-blue-400 hover:bg-blue-50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <p className="text-2xl mb-2">🖼</p>
              <p className="text-slate-600 font-medium">拖曳圖片至此，或點擊選擇檔案</p>
              <p className="mt-1 text-xs text-slate-400">支援 PNG、JPG、WEBP</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyze(f) }}
            />
            <p className="mt-3 text-xs text-slate-400">
              需要本機 Ollama（gemma4）在運行中。啟動指令：<code className="rounded bg-slate-100 px-1">OLLAMA_ORIGINS=* ollama serve</code>
            </p>
          </>
        )}

        {phase === 'analyzing' && (
          <div className="py-6 text-center">
            {previewUrl && (
              <img src={previewUrl} className="mx-auto mb-4 max-h-40 rounded-lg object-contain shadow" alt="上傳圖片" />
            )}
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <p className="text-sm text-slate-600">AI 正在分析圖片，請稍候（約 30–90 秒）…</p>
          </div>
        )}

        {phase === 'error' && (
          <div>
            {previewUrl && (
              <img src={previewUrl} className="mx-auto mb-4 max-h-40 rounded-lg object-contain shadow" alt="上傳圖片" />
            )}
            <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700 whitespace-pre-wrap">{errorMsg}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setPhase('idle'); setPreviewUrl(null) }} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">重新上傳</button>
              <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">關閉</button>
            </div>
          </div>
        )}

        {phase === 'done' && result && (
          <div>
            {previewUrl && (
              <img src={previewUrl} className="mx-auto mb-4 max-h-32 rounded-lg object-contain shadow" alt="上傳圖片" />
            )}
            <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              {mode === 'er' ? (
                <>
                  識別到 <b>{(result as ERVisionResult).entities.length}</b> 個實體、
                  <b>{(result as ERVisionResult).attributes.length}</b> 個屬性、
                  <b>{(result as ERVisionResult).relationships.length}</b> 個關係
                </>
              ) : (
                <>
                  識別到 <b>{(result as LogicalVisionResult).tables.length}</b> 個資料表、
                  <b>{(result as LogicalVisionResult).relationships.length}</b> 個關聯
                </>
              )}
            </div>

            <div className="mb-4 max-h-52 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              {mode === 'er'
                ? (result as ERVisionResult).entities.map((e) => (
                    <div key={e.id}>
                      <span className="font-semibold">{e.name}</span>
                      {' — '}
                      {(result as ERVisionResult).attributes
                        .filter((a) => a.entityId === e.id)
                        .map((a) => (a.isPrimaryKey ? `🔑${a.name}` : a.name))
                        .join('、') || '（無屬性）'}
                    </div>
                  ))
                : (result as LogicalVisionResult).tables.map((t, i) => (
                    <div key={i}>
                      <span className="font-semibold">{t.name}</span>
                      {' — '}
                      {t.fields.map((f) => (f.isPK ? `🔑${f.name}` : f.name)).join('、')}
                    </div>
                  ))}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPhase('idle'); setPreviewUrl(null); setResult(null) }} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">重新上傳</button>
              <button type="button" onClick={handleConfirm} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">匯入至畫布</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
