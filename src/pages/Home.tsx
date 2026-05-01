import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { TrashModal } from '../components/TrashModal'
import { Diagram, DiagramType } from '../types'

interface CreateDialogState {
  open: boolean
  type: CreatableDiagramType | null
}

type LightMode = 'cool' | 'warm' | 'night'
type TrashMood = 'idle' | 'eat' | 'spit'
type CreatableDiagramType = Exclude<DiagramType, 'physical'>

const EMPTY_CREATE_STATE: CreateDialogState = { open: false, type: null }
const LIGHT_MODES: LightMode[] = ['cool', 'warm', 'night']

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

const lightModeLabelMap: Record<LightMode, string> = {
  cool: '白光',
  warm: '暖光',
  night: '夜光'
}

const formatDateTime = (value: string) => new Date(value).toLocaleString()
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

// DB column may be `diagram_type` (old Vue schema) or `type` (migrated schema)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeDiagram = (row: any): Diagram => ({
  ...row,
  type: (row.type ?? row.diagram_type ?? 'er') as DiagramType
})

const decodeAuthMessage = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

const readOAuthErrorFromLocation = () => {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  const raw =
    hashParams.get('error_description') ??
    hashParams.get('error') ??
    searchParams.get('error_description') ??
    searchParams.get('error')
  return raw ? decodeAuthMessage(raw) : null
}

export default function Home() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [loginOptionsOpen, setLoginOptionsOpen] = useState(false)
  const [chainPulled, setChainPulled] = useState(false)
  const [googleSending, setGoogleSending] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [emailFallbackEnabled, setEmailFallbackEnabled] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginSent, setLoginSent] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSending, setLoginSending] = useState(false)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lightMode, setLightMode] = useState<LightMode>('cool')
  const [modeChainPulled, setModeChainPulled] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [trashMood, setTrashMood] = useState<TrashMood>('idle')
  const [swallowingDiagramId, setSwallowingDiagramId] = useState<string | null>(null)
  const [projectionActive, setProjectionActive] = useState(false)

  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const [deletedDiagrams, setDeletedDiagrams] = useState<Diagram[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const [createDialog, setCreateDialog] = useState<CreateDialogState>(EMPTY_CREATE_STATE)
  const [newDiagramName, setNewDiagramName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const oauthErrorMessage = readOAuthErrorFromLocation()
    if (!oauthErrorMessage) return
    setGoogleError(`Google 登入失敗：${oauthErrorMessage}`)
    setEmailFallbackEnabled(true)
    setLoginOptionsOpen(true)
    window.history.replaceState({}, document.title, window.location.pathname)
  }, [])

  useEffect(() => {
    const cached = window.localStorage.getItem('home-light-mode') as LightMode | null
    if (cached && LIGHT_MODES.includes(cached)) setLightMode(cached)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('home-light-mode', lightMode)
  }, [lightMode])

  const handleToggleLoginOptions = () => {
    setLoginOptionsOpen((value) => !value)
    setChainPulled(true)
    window.setTimeout(() => setChainPulled(false), 260)
  }

  const triggerTrashMood = (mood: Exclude<TrashMood, 'idle'>) => {
    setTrashMood(mood)
    window.setTimeout(() => setTrashMood('idle'), 720)
  }

  const handleCycleLightMode = () => {
    setModeChainPulled(true)
    window.setTimeout(() => setModeChainPulled(false), 240)
    setLightMode((previous) => {
      const index = LIGHT_MODES.indexOf(previous)
      return LIGHT_MODES[(index + 1) % LIGHT_MODES.length]
    })
  }

  const handleGoogleLogin = async () => {
    setGoogleSending(true)
    setGoogleError(null)
    setLoginError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        scopes: 'https://www.googleapis.com/auth/userinfo.email'
      }
    })
    if (error) {
      setGoogleSending(false)
      setGoogleError(`Google 登入失敗：${error.message}`)
      setEmailFallbackEnabled(true)
      return
    }
    setGoogleSending(false)
  }

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
    if (error) {
      setLoginError(error.message)
      return
    }
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

  const openCreateDialog = (type: CreatableDiagramType) => {
    setCreateDialog({ open: true, type })
    setNewDiagramName(typeTextMap[type])
    setProjectionActive(true)
    window.setTimeout(() => setProjectionActive(false), 900)
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
        deleted_at: null,
        content: {}
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

    setSwallowingDiagramId(diagramId)
    triggerTrashMood('eat')
    await sleep(420)

    setSaving(true)
    const { error } = await supabase
      .from('diagrams')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', diagramId)
    setSaving(false)

    if (error) {
      setSwallowingDiagramId(null)
      setErrorMessage(error.message)
      return
    }

    setSwallowingDiagramId(null)
    await fetchDiagrams()
  }

  const handleRenameDiagram = async (diagramId: string, currentName: string) => {
    const nextNameRaw = window.prompt('請輸入新的圖表名稱', currentName)
    if (nextNameRaw === null) return

    const nextName = nextNameRaw.trim()
    if (!nextName) {
      window.alert('圖表名稱不可為空。')
      return
    }
    if (nextName === currentName) return

    setSaving(true)
    const { error } = await supabase.from('diagrams').update({ name: nextName }).eq('id', diagramId)
    setSaving(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    await fetchDiagrams()
  }

  const handleRestore = async (diagramId: string) => {
    triggerTrashMood('spit')
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

  const handleRestoreAll = async () => {
    if (deletedDiagrams.length === 0) return
    const confirmed = window.confirm(`確定要復原垃圾桶內全部 ${deletedDiagrams.length} 張圖表嗎？`)
    if (!confirmed) return

    const ids = deletedDiagrams.map((item) => item.id)
    const { error } = await supabase.from('diagrams').update({ deleted_at: null }).in('id', ids)
    if (error) {
      setErrorMessage(error.message)
      return
    }
    triggerTrashMood('spit')
    await fetchDiagrams()
  }

  const handleDeleteForeverAll = async () => {
    if (deletedDiagrams.length === 0) return
    const firstConfirm = window.confirm(`此操作無法復原，確定要永久刪除垃圾桶內全部 ${deletedDiagrams.length} 張圖表嗎？`)
    if (!firstConfirm) return
    const secondConfirm = window.confirm('請再次確認：真的要永久刪除垃圾桶全部圖表？')
    if (!secondConfirm) return

    const ids = deletedDiagrams.map((item) => item.id)
    const { error } = await supabase.from('diagrams').delete().in('id', ids)
    if (error) {
      setErrorMessage(error.message)
      return
    }
    await fetchDiagrams()
  }

  const handleRename = async (diagramId: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    setEditingId(null)
    setDiagrams((previous) =>
      previous.map((diagram) => (diagram.id === diagramId ? { ...diagram, name: trimmed } : diagram))
    )
    const { error } = await supabase.from('diagrams').update({ name: trimmed }).eq('id', diagramId)
    if (error) {
      setErrorMessage(error.message)
    }
  }

  if (authLoading) {
    return (
      <main className="glass-page flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">載入中…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="scene">
        <section className="lamp-wrap">
          <div className={`lamp ${loginOptionsOpen ? 'on' : ''}`} aria-label="desk-lamp">
            <div className="light" aria-hidden="true" />
            <button
              type="button"
              aria-label={loginOptionsOpen ? '關閉登入面板' : '開啟登入面板'}
              aria-expanded={loginOptionsOpen}
              className={`chain-hit hint ${chainPulled ? 'pulled' : ''}`}
              onClick={handleToggleLoginOptions}
            >
              <span className="chain" aria-hidden="true" />
              <span className="weight" aria-hidden="true" />
            </button>
            <div className="head" />
            <div className="bulb" />
            <div className="arm" />
            <div className="base" />
          </div>

          <aside className={`login-panel ${loginOptionsOpen ? 'show' : ''}`} aria-hidden={!loginOptionsOpen}>
            <h2>登入</h2>
            <p className="hint-text">先使用 Google 登入，失敗才改用 Email 登入連結</p>

            <button
              type="button"
              disabled={googleSending}
              className="btn"
              onClick={() => void handleGoogleLogin()}
            >
              {googleSending ? '跳轉 Google 中…' : '使用 Google 登入'}
            </button>

            {googleError && <p className="error-text">{googleError}</p>}

            {emailFallbackEnabled && (
              <div className="fallback-wrap">
                <p className="hint-text">Google 登入失敗，改用信箱登入連結：</p>
                {loginSent ? (
                  <div className="success-text">
                    已寄出登入連結至 <strong>{loginEmail}</strong>，請去信箱點擊連結完成登入。
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleLogin(e)}>
                    <div className="field">
                      <label htmlFor="login-email">Email</label>
                      <input
                        id="login-email"
                        type="email"
                        required
                        placeholder="you@example.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </div>
                    {loginError && <p className="error-text">{loginError}</p>}
                    <button type="submit" disabled={loginSending} className="btn btn-secondary">
                      {loginSending ? '寄送中…' : '寄送登入連結'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </aside>
        </section>
      </main>
    )
  }

  return (
    <main className={`glass-page home-light-${lightMode} home-layout min-h-screen px-4 py-6 md:px-6 md:py-8`}>
      <div className="home-light-aura" aria-hidden="true" />
      {projectionActive && (
        <div className="projection-layer" aria-hidden="true">
          <div className="projection-beam" />
          <div className="projection-card" />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row">
        <aside className={`glass-card home-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <button
            type="button"
            className="home-sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? '展開工具列' : '收合工具列'}
          >
            {sidebarCollapsed ? '⟩' : '⟨'}
          </button>

          <div className="home-sidebar-actions">
            <button
              type="button"
              className="home-sidebar-btn"
              onClick={() => openCreateDialog('er')}
              title="新增 ER 圖"
            >
              <span className="home-sidebar-icon">＋</span>
              <span className="home-sidebar-text">新增 ER 圖</span>
            </button>
            <button
              type="button"
              className="home-sidebar-btn"
              onClick={() => openCreateDialog('logical')}
              title="新增邏輯圖"
            >
              <span className="home-sidebar-icon">＋</span>
              <span className="home-sidebar-text">新增邏輯圖</span>
            </button>
            <button
              type="button"
              className={`home-sidebar-btn trash-monster trash-monster-${trashMood}`}
              onClick={() => setTrashOpen(true)}
              title="垃圾桶"
            >
              <span className="trash-face" aria-hidden="true">
                <span className="trash-eye" />
                <span className="trash-eye" />
                <span className="trash-mouth" />
              </span>
              <span className="home-sidebar-text">垃圾桶</span>
            </button>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="glass-card mb-6 flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-slate-700">ERCanvas Workspace</div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
              <span className="max-w-full truncate text-xs text-slate-500">{user.email}</span>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => void handleLogout()}
              >
                登出
              </button>
              <button
                type="button"
                className={`mode-chain-toggle home-chain-toggle ${modeChainPulled ? 'pulled' : ''}`}
                onClick={handleCycleLightMode}
                title="拉繩切換燈光模式"
              >
                <span className="mode-chain-line" />
                <span className="mode-chain-knob" />
                <span className="mode-chain-label">{lightModeLabelMap[lightMode]}</span>
              </button>
            </div>
          </header>

          {errorMessage && <p className="mb-4 text-sm text-rose-600">{errorMessage}</p>}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <div className="glass-card rounded-lg p-4 text-sm text-slate-500">
                載入圖表中...
              </div>
            ) : activeDiagrams.length === 0 ? (
              <div className="glass-card rounded-lg p-6 text-sm text-slate-500">
                尚無圖表，請從左側工作列建立第一張圖。
              </div>
            ) : (
              activeDiagrams.map((diagram) => (
                <article
                  key={diagram.id}
                  className={`glass-card home-card relative rounded-xl p-4 ${swallowingDiagramId === diagram.id ? 'swallowing' : ''}`}
                  onContextMenu={(event) => {
                    if ((event.target as HTMLElement).closest('[data-ignore-rename-context]')) return
                    event.preventDefault()
                    if (saving) return
                    void handleRenameDiagram(diagram.id, diagram.name)
                  }}
                >
                  <button
                    type="button"
                    data-ignore-rename-context="true"
                    className="icon-button home-delete-button absolute z-10 text-slate-500 hover:text-rose-600"
                    onClick={() => void handleSoftDelete(diagram.id)}
                    title="移到垃圾桶"
                  >
                    🗑
                  </button>
                  <button
                    type="button"
                    data-ignore-rename-context="true"
                    className="absolute right-10 top-2 z-10 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    onClick={() => void handleRenameDiagram(diagram.id, diagram.name)}
                    title="重新命名"
                  >
                    改名
                  </button>

                  {editingId === diagram.id ? (
                    <input
                      className="mb-2 w-full rounded border border-blue-400 px-2 py-1 pr-8 text-lg font-semibold text-slate-800 outline-none ring-2 ring-blue-200"
                      autoFocus
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onBlur={() => void handleRename(diagram.id, editingName)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleRename(diagram.id, editingName)
                        if (event.key === 'Escape') {
                          setEditingId(null)
                          setEditingName('')
                        }
                      }}
                    />
                  ) : (
                    <h3
                      className="mb-2 cursor-text pr-8 text-lg font-semibold text-slate-800"
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        setEditingId(diagram.id)
                        setEditingName(diagram.name)
                      }}
                    >
                      {diagram.name}
                    </h3>
                  )}

                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      if (editingId === diagram.id) return
                      navigate(`/diagram/${typeRouteMap[diagram.type] ?? 'er'}/${diagram.id}`)
                    }}
                  >
                    <p className="mb-1 text-sm text-slate-600">類型：{typeTextMap[diagram.type]}</p>
                    <p className="text-xs text-slate-500">更新：{formatDateTime(diagram.updated_at)}</p>
                  </button>
                </article>
              ))
            )}
          </section>
        </section>

        <TrashModal
          open={trashOpen}
          diagrams={deletedDiagrams}
          loading={loading}
          onClose={() => setTrashOpen(false)}
          onRestore={handleRestore}
          onRestoreAll={handleRestoreAll}
          onDeleteForever={handleDeleteForever}
          onDeleteForeverAll={handleDeleteForeverAll}
        />

        {createDialog.open && createDialog.type && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="glass-modal projected-modal w-full max-w-md p-5 shadow-xl">
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
