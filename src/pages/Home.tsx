import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { TrashModal } from '../components/TrashModal'
import { Diagram, DiagramType } from '../types'

interface CreateDialogState {
  open: boolean
  type: DiagramType | null
}

const EMPTY_CREATE_STATE: CreateDialogState = { open: false, type: null }

const typeRouteMap: Record<DiagramType, string> = {
  er: 'er',
  logical: 'logical',
  physical: 'physical'
}

const typeTextMap: Record<DiagramType, string> = {
  er: 'ER 圖',
  logical: '邏輯圖',
  physical: '實體圖'
}

const formatDateTime = (value: string) => new Date(value).toLocaleString()

// DB column may be `diagram_type` (old Vue schema) or `type` (migrated schema)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeDiagram = (row: any): Diagram => ({
  ...row,
  type: (row.type ?? row.diagram_type ?? 'er') as DiagramType
})

export default function Home() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginSent, setLoginSent] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSending, setLoginSending] = useState(false)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const [deletedDiagrams, setDeletedDiagrams] = useState<Diagram[]>([])
  const [trashOpen, setTrashOpen] = useState(false)

  const [createDialog, setCreateDialog] = useState<CreateDialogState>(EMPTY_CREATE_STATE)
  const [newDiagramName, setNewDiagramName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Auth state
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (!loginEmail.trim()) return
    setLoginSending(true)
    setLoginError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: loginEmail.trim(),
      options: { emailRedirectTo: window.location.origin }
    })
    setLoginSending(false)
    if (error) { setLoginError(error.message); return }
    setLoginSent(true)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setDiagrams([])
    setDeletedDiagrams([])
  }

  const activeDiagrams = useMemo(
    () =>
      diagrams
        .filter((item) => item.deleted_at === null)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [diagrams]
  )

  const fetchDiagrams = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)

    const [activeResult, deletedResult] = await Promise.all([
      supabase.from('diagrams').select('*').is('deleted_at', null).order('updated_at', { ascending: false }),
      supabase
        .from('diagrams')
        .select('*')
        .not('deleted_at', 'is', null)
        .order('updated_at', { ascending: false })
    ])

    setLoading(false)

    if (activeResult.error || deletedResult.error) {
      setErrorMessage(activeResult.error?.message ?? deletedResult.error?.message ?? '載入失敗')
      return
    }

    setDiagrams((activeResult.data ?? []).map(normalizeDiagram) as Diagram[])
    setDeletedDiagrams((deletedResult.data ?? []).map(normalizeDiagram) as Diagram[])
  }, [])

  useEffect(() => {
    if (user) void fetchDiagrams()
  }, [fetchDiagrams, user])

  const openCreateDialog = (type: DiagramType) => {
    setCreateDialog({ open: true, type })
    setNewDiagramName(typeTextMap[type])
  }

  const closeCreateDialog = () => {
    setCreateDialog(EMPTY_CREATE_STATE)
    setNewDiagramName('')
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()

    if (!createDialog.type) return

    const name = newDiagramName.trim()
    if (!name) return

    setSaving(true)
    setErrorMessage(null)

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setSaving(false)
      setErrorMessage('請先登入後再建立圖表。')
      return
    }

    const { data, error } = await supabase
      .from('diagrams')
      .insert({
        user_id: authData.user.id,
        name,
        type: createDialog.type,
        deleted_at: null
      })
      .select('*')
      .single()

    setSaving(false)

    if (error || !data) {
      setErrorMessage(error?.message ?? '建立圖表失敗')
      return
    }

    closeCreateDialog()
    await fetchDiagrams()
    navigate(`/diagram/${typeRouteMap[data.type as DiagramType]}/${data.id}`)
  }

  const handleSoftDelete = async (diagramId: string) => {
    const confirmed = window.confirm('確定要將此圖表移到垃圾桶嗎？')
    if (!confirmed) return

    setSaving(true)
    const { error } = await supabase
      .from('diagrams')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', diagramId)
    setSaving(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    await fetchDiagrams()
  }

  const handleRestore = async (diagramId: string) => {
    const { error } = await supabase.from('diagrams').update({ deleted_at: null }).eq('id', diagramId)
    if (error) {
      setErrorMessage(error.message)
      return
    }
    await fetchDiagrams()
  }

  const handleDeleteForever = async (diagramId: string) => {
    const firstConfirm = window.confirm('此操作無法復原，確定要永久刪除嗎？')
    if (!firstConfirm) return
    const secondConfirm = window.confirm('請再次確認：真的要永久刪除這張圖表？')
    if (!secondConfirm) return

    const { error } = await supabase.from('diagrams').delete().eq('id', diagramId)
    if (error) {
      setErrorMessage(error.message)
      return
    }
    await fetchDiagrams()
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">載入中…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mb-2 inline-block rounded-md bg-[#2650ff] px-3 py-1 text-sm font-bold text-white">ERCanvas</div>
            <h1 className="text-xl font-bold text-slate-800">登入</h1>
            <p className="mt-1 text-sm text-slate-500">輸入 Email，我們會寄送登入連結給你</p>
          </div>

          {loginSent ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-700">
              已寄出登入連結至 <strong>{loginEmail}</strong>，請去信箱點擊連結完成登入。
            </div>
          ) : (
            <form onSubmit={(e) => void handleLogin(e)} className="space-y-3">
              <input
                type="email"
                required
                placeholder="your@email.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
              {loginError && <p className="text-xs text-rose-600">{loginError}</p>}
              <button
                type="submit"
                disabled={loginSending}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {loginSending ? '寄送中…' : '寄送登入連結'}
              </button>
            </form>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => openCreateDialog('er')}
            >
              ＋ 新增 ER 圖
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => openCreateDialog('logical')}
            >
              ＋ 新增邏輯圖
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => openCreateDialog('physical')}
            >
              ＋ 新增實體圖
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{user.email}</span>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => void handleLogout()}
            >
              登出
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => setTrashOpen(true)}
            >
              🗑 垃圾桶
            </button>
          </div>
        </header>

        {errorMessage && <p className="mb-4 text-sm text-rose-600">{errorMessage}</p>}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              載入圖表中...
            </div>
          ) : activeDiagrams.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
              尚無圖表，請從上方按鈕建立第一張圖。
            </div>
          ) : (
            activeDiagrams.map((diagram) => (
              <article key={diagram.id} className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
                  onClick={() => handleSoftDelete(diagram.id)}
                  title="移到垃圾桶"
                >
                  🗑
                </button>

                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => navigate(`/diagram/${typeRouteMap[diagram.type] ?? 'er'}/${diagram.id}`)}
                >
                  <h3 className="mb-2 pr-8 text-lg font-semibold text-slate-800">{diagram.name}</h3>
                  <p className="mb-1 text-sm text-slate-600">類型：{typeTextMap[diagram.type]}</p>
                  <p className="text-xs text-slate-500">更新：{formatDateTime(diagram.updated_at)}</p>
                </button>
              </article>
            ))
          )}
        </section>

        <TrashModal
          open={trashOpen}
          diagrams={deletedDiagrams}
          loading={loading}
          onClose={() => setTrashOpen(false)}
          onRestore={handleRestore}
          onDeleteForever={handleDeleteForever}
        />

        {createDialog.open && createDialog.type && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="mb-4 text-lg font-semibold text-slate-800">
                新增 {typeTextMap[createDialog.type]}
              </h2>

              <form className="space-y-4" onSubmit={handleCreate}>
                <input
                  value={newDiagramName}
                  onChange={(event) => setNewDiagramName(event.target.value)}
                  placeholder="請輸入圖表名稱"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                    onClick={closeCreateDialog}
                    disabled={saving}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                    disabled={saving || !newDiagramName.trim()}
                  >
                    {saving ? '建立中...' : '建立'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
