<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDiagramsStore } from '@/stores/diagrams'

const router = useRouter()
const auth = useAuthStore()
const diagrams = useDiagramsStore()

const showTrash = ref(false)
const creatingType = ref(null)
const renamingId = ref(null)
const renameValue = ref('')
const contextMenu = ref(null) // { id, x, y, trashed }
const searchQuery = ref('')
const batchInFlight = ref(false)

const filteredDiagrams = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const list = showTrash.value ? diagrams.trashedDiagrams : diagrams.myDiagrams
  if (!q) return list
  return list.filter(d => (d.name || '未命名').toLowerCase().includes(q))
})

const TYPES = [
  { key: 'er', label: 'ER 圖', icon: '🗂️', desc: 'Entity-Relationship 模型' },
  { key: 'logical', label: 'LM 圖', icon: '📐', desc: 'Logical Model 邏輯模型' },
  { key: 'physical', label: 'PM 圖', icon: '🏗️', desc: 'Physical Model 實體模型' },
  { key: 'table', label: '資料表', icon: '📊', desc: 'Physical Table 資料表設計' },
]

function typeLabel(type) {
  return TYPES.find(t => t.key === type)?.label || type?.toUpperCase() || 'ER'
}

function typeColor(type) {
  const map = { er: '#0a84ff', logical: '#30d158', physical: '#ff9f0a', table: '#bf5af2' }
  return map[type] || '#0a84ff'
}

function formatDate(val) {
  if (!val) return ''
  const d = val?.toDate ? val.toDate() : new Date(val)
  if (isNaN(d)) return ''
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '剛剛'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return d.toLocaleDateString('zh-TW')
}

async function createDiagram(type) {
  if (creatingType.value) return
  creatingType.value = type
  try {
    const id = await diagrams.createDiagram(auth.user.uid, type)
    const editorType = type === 'table' ? 'physical' : type
    router.push({ path: '/editor', query: { id, type: editorType } })
  } catch (e) {
    alert(e.message || '建立圖表失敗，請先確認 Supabase 資料表與權限設定完成。')
  } finally {
    creatingType.value = null
  }
}

function openDiagram(d) {
  if (!d) return
  const editorType = d.type === 'table' ? 'physical' : (d.type || 'er')
  router.push({ path: '/editor', query: { id: d.id, type: editorType } })
}

function openContextMenu(e, d) {
  e.preventDefault()
  const trashed = !!d.deletedAt
  contextMenu.value = { id: d.id, x: e.clientX, y: e.clientY, trashed, name: d.name }
}

function closeContextMenu() {
  contextMenu.value = null
}

async function handleTrash(id) {
  closeContextMenu()
  try {
    await diagrams.trash(auth.user.uid, id)
  } catch (e) {
    alert(e.message || '移至垃圾桶失敗')
  }
}

async function handleRestore(id) {
  closeContextMenu()
  try {
    await diagrams.restore(auth.user.uid, id)
  } catch (e) {
    alert(e.message || '還原失敗')
  }
}

async function handlePermDelete(id) {
  closeContextMenu()
  try {
    await diagrams.permDelete(auth.user.uid, id)
  } catch (e) {
    alert(e.message || '永久刪除失敗')
  }
}

async function handleTrashAll() {
  if (batchInFlight.value) return
  if (!confirm('將所有圖表移至垃圾桶？')) return
  batchInFlight.value = true
  try {
    await diagrams.trashAll(auth.user.uid)
  } catch (e) {
    alert(e.message || '批次移至垃圾桶失敗')
  } finally {
    batchInFlight.value = false
  }
}

async function handleRestoreAll() {
  if (batchInFlight.value) return
  batchInFlight.value = true
  try {
    await diagrams.restoreAll(auth.user.uid)
  } catch (e) {
    alert(e.message || '批次還原失敗')
  } finally {
    batchInFlight.value = false
  }
}

async function handlePermDeleteAll() {
  if (batchInFlight.value) return
  if (!confirm('永久刪除所有垃圾桶內的圖表？此操作無法復原。')) return
  batchInFlight.value = true
  try {
    await diagrams.permDeleteAll(auth.user.uid)
  } catch (e) {
    alert(e.message || '批次永久刪除失敗')
  } finally {
    batchInFlight.value = false
  }
}

function startRename(d) {
  if (!d) return
  closeContextMenu()
  renamingId.value = d.id
  renameValue.value = d.name || ''
}

async function commitRename(id) {
  const name = renameValue.value.trim()
  if (name) {
    const original = diagrams.diagrams.find(d => d.id === id)?.name || ''
    try {
      await diagrams.rename(auth.user.uid, id, name)
    } catch (e) {
      alert(e.message || '重新命名失敗')
      renameValue.value = original  // restore so user can retry
      return
    }
  }
  renamingId.value = null
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}

function onDocClick(e) {
  if (contextMenu.value && !e.target.closest('.context-menu')) {
    closeContextMenu()
  }
}

onMounted(() => {
  if (auth.user) diagrams.subscribe(auth.user.uid)
  document.addEventListener('click', onDocClick)
})

// Stop the watcher first so it can't fire after we've already unsubscribed.
const stopAuthWatcher = watch(() => auth.user, (u) => {
  if (u) diagrams.subscribe(u.uid)
  else diagrams.unsubscribe()
})

onUnmounted(() => {
  stopAuthWatcher()
  diagrams.unsubscribe()
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="home-root" @click="closeContextMenu">
    <!-- Header -->
    <header class="mac-main-header">
      <div class="mac-window-controls">
        <span class="mac-window-dot dot-red"></span>
        <span class="mac-window-dot dot-yellow"></span>
        <span class="mac-window-dot dot-green"></span>
      </div>
      <div class="header-title">
        <svg width="18" height="18" viewBox="0 0 36 36" fill="none" style="flex-shrink:0">
          <rect x="4" y="4" width="12" height="12" rx="2" fill="var(--mac-accent)"/>
          <rect x="20" y="4" width="12" height="12" rx="2" fill="var(--mac-accent)" opacity="0.7"/>
          <rect x="4" y="20" width="12" height="12" rx="2" fill="var(--mac-accent)" opacity="0.7"/>
          <rect x="20" y="20" width="12" height="12" rx="2" fill="var(--mac-accent)" opacity="0.5"/>
        </svg>
        <span>ERCanvas</span>
      </div>
      <div class="header-right">
        <div class="search-box">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="color:var(--mac-muted)">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.8"/>
            <path d="m13 13 3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <input v-model="searchQuery" placeholder="搜尋圖表..." class="search-input" />
        </div>
        <button @click="handleLogout" class="logout-btn" title="登出">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="user-avatar" :title="auth.user?.email">
          <img v-if="auth.user?.photoURL" :src="auth.user.photoURL" :alt="auth.user.displayName" />
          <span v-else>{{ auth.user?.displayName?.[0] || '?' }}</span>
        </div>
      </div>
    </header>

    <div class="home-body">
      <!-- Sidebar -->
      <aside class="home-sidebar">
        <nav class="sidebar-nav">
          <button
            class="sidebar-item"
            :class="{ active: !showTrash }"
            @click="showTrash = false"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            <span>所有圖表</span>
            <span v-if="diagrams.myDiagrams.length" class="sidebar-badge">{{ diagrams.myDiagrams.length }}</span>
          </button>
          <button
            class="sidebar-item"
            :class="{ active: showTrash }"
            @click="showTrash = true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span>垃圾桶</span>
            <span v-if="diagrams.trashedDiagrams.length" class="sidebar-badge">{{ diagrams.trashedDiagrams.length }}</span>
          </button>
        </nav>

        <div class="sidebar-section-label">建立新圖表</div>
        <div class="create-buttons">
          <button
            v-for="t in TYPES"
            :key="t.key"
            class="create-btn"
            :disabled="creatingType !== null"
            @click="createDiagram(t.key)"
          >
            <span class="create-btn-icon">{{ t.icon }}</span>
            <span class="create-btn-label">{{ t.label }}</span>
            <svg v-if="creatingType === t.key" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" style="opacity:0.4">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </aside>

      <!-- Main -->
      <main class="home-main">
        <!-- Trash header -->
        <div v-if="showTrash && diagrams.trashedDiagrams.length" class="trash-header">
          <span style="color:var(--mac-subtext); font-size:13px;">垃圾桶中的項目不會自動刪除</span>
          <div class="trash-actions">
            <button class="ghost-btn" @click="handleRestoreAll">全部還原</button>
            <button class="ghost-btn danger" @click="handlePermDeleteAll">永久刪除全部</button>
          </div>
        </div>

        <div v-if="!showTrash" class="migration-banner">
          <div>
            <strong>Vue 3 + Supabase 遷移已接通主流程</strong>
            <p>目前登入、圖表列表與 CRUD 已切到 Supabase，編輯器則先透過整理後的 legacy engine 持續運作。</p>
          </div>
          <button class="banner-btn" @click="router.push('/editor')">開啟編輯器</button>
        </div>

        <div v-if="diagrams.error" class="error-banner">
          <strong>Supabase 資料層尚未就緒</strong>
          <p>{{ diagrams.error }}</p>
          <p>請先建立 `public.diagrams`、啟用 RLS，以及設定對應 policy。</p>
        </div>

        <!-- Loading skeletons -->
        <div v-if="diagrams.loading" class="diagram-grid">
          <div v-for="i in 6" :key="i" class="diagram-card skeleton"></div>
        </div>

        <!-- Empty state -->
        <div v-else-if="filteredDiagrams.length === 0" class="empty-state">
          <div v-if="showTrash">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="opacity:0.25; margin:0 auto 12px">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.5"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <p>垃圾桶是空的</p>
          </div>
          <div v-else>
            <svg width="48" height="48" viewBox="0 0 36 36" fill="none" style="opacity:0.2; margin:0 auto 12px">
              <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <rect x="20" y="4" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <rect x="4" y="20" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <rect x="20" y="20" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            <p>還沒有圖表</p>
            <p style="font-size:13px; margin-top:4px">從左側選擇類型來建立第一張圖表</p>
          </div>
        </div>

        <!-- Diagram grid -->
        <div v-else class="diagram-grid">
          <div
            v-for="d in filteredDiagrams"
            :key="d.id"
            class="diagram-card"
            :class="{ trashed: !!d.deletedAt }"
            @click="!d.deletedAt && openDiagram(d)"
            @contextmenu="openContextMenu($event, d)"
          >
            <!-- Card preview area -->
            <div class="card-preview" :style="{ '--type-color': typeColor(d.type) }">
              <div class="card-type-badge">{{ typeLabel(d.type) }}</div>
              <div class="card-preview-icon">
                <svg width="40" height="40" viewBox="0 0 36 36" fill="none" opacity="0.15">
                  <rect x="4" y="4" width="12" height="12" rx="2" fill="var(--type-color)"/>
                  <rect x="20" y="4" width="12" height="12" rx="2" fill="var(--type-color)"/>
                  <rect x="4" y="20" width="12" height="12" rx="2" fill="var(--type-color)"/>
                  <rect x="20" y="20" width="12" height="12" rx="2" fill="var(--type-color)"/>
                </svg>
              </div>
            </div>

            <!-- Card info -->
            <div class="card-info">
              <div v-if="renamingId === d.id" class="rename-input-wrap" @click.stop>
                <input
                  v-model="renameValue"
                  class="rename-input"
                  @keydown.enter="commitRename(d.id)"
                  @keydown.escape="renamingId = null"
                  @blur="commitRename(d.id)"
                  autofocus
                />
              </div>
              <div v-else class="card-name">{{ d.name || '未命名' }}</div>
              <div class="card-meta">{{ formatDate(d.updatedAt) }}</div>
            </div>

            <!-- Card actions -->
            <button class="card-more-btn" @click.stop="openContextMenu($event, d)" title="更多">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
          </div>
        </div>
      </main>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <template v-if="!contextMenu.trashed">
          <button class="ctx-item" @click="openDiagram(diagrams.diagrams.find(d => d.id === contextMenu.id))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="15 3 21 3 21 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            開啟
          </button>
          <button class="ctx-item" @click="startRename(diagrams.diagrams.find(d => d.id === contextMenu.id))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            重新命名
          </button>
          <div class="ctx-divider"></div>
          <button class="ctx-item danger" @click="handleTrash(contextMenu.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            移至垃圾桶
          </button>
        </template>
        <template v-else>
          <button class="ctx-item" @click="handleRestore(contextMenu.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="1 4 1 10 7 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.51 15a9 9 0 1 0 .49-4.95L1 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            還原
          </button>
          <button class="ctx-item danger" @click="handlePermDelete(contextMenu.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            永久刪除
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.home-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--mac-bg);
}

.mac-main-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 52px;
  background: var(--mac-panel);
  border-bottom: 1px solid var(--mac-border);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.mac-window-controls {
  display: flex;
  gap: 7px;
  align-items: center;
  -webkit-app-region: no-drag;
}

.mac-window-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.dot-red { background: #ff5f57; }
.dot-yellow { background: #febc2e; }
.dot-green { background: #28c840; }

.header-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--mac-text);
}

.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  background: var(--mac-surface);
  border: 1px solid var(--mac-border);
  border-radius: 8px;
}

.search-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: var(--mac-text);
  width: 180px;
}

.search-input::placeholder { color: var(--mac-muted); }

.logout-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  color: var(--mac-subtext);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}
.logout-btn:hover { background: var(--mac-danger-soft); color: #ff453a; border-color: rgba(255,69,58,0.3); }

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--mac-accent-soft);
  border: 1.5px solid var(--mac-border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--mac-accent);
}
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }

.home-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.home-sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: 16px 12px;
  background: var(--mac-panel);
  border-right: 1px solid var(--mac-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--mac-subtext);
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.sidebar-item:hover { background: var(--mac-surface); color: var(--mac-text); }
.sidebar-item.active { background: var(--mac-accent-soft); color: var(--mac-accent); font-weight: 500; }

.sidebar-badge {
  margin-left: auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--mac-surface);
  color: var(--mac-muted);
}
.sidebar-item.active .sidebar-badge { background: var(--mac-accent); color: white; }

.sidebar-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--mac-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 10px;
  margin-bottom: 6px;
}

.create-buttons {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--mac-subtext);
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.create-btn:hover:not(:disabled) { background: var(--mac-surface); color: var(--mac-text); }
.create-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.create-btn-icon { font-size: 15px; }
.create-btn-label { flex: 1; }

.home-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.migration-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  margin-bottom: 18px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(10, 132, 255, 0.14), rgba(48, 209, 88, 0.08));
  border: 1px solid rgba(10, 132, 255, 0.18);
}

.migration-banner strong {
  display: block;
  font-size: 13px;
  color: var(--mac-text);
}

.migration-banner p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--mac-subtext);
}

.banner-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: var(--mac-accent);
  color: white;
  font-size: 12.5px;
  font-weight: 600;
  padding: 9px 12px;
  cursor: pointer;
}

.banner-btn:hover {
  background: var(--mac-accent-strong);
}

.error-banner {
  margin-bottom: 18px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 69, 58, 0.08);
  border: 1px solid rgba(255, 69, 58, 0.18);
}

.error-banner strong {
  display: block;
  font-size: 13px;
  color: #b42318;
}

.error-banner p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--mac-subtext);
}

.trash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding: 10px 14px;
  background: var(--mac-danger-soft);
  border: 1px solid rgba(255,69,58,0.2);
  border-radius: 10px;
}

.trash-actions { display: flex; gap: 8px; }

.ghost-btn {
  padding: 5px 12px;
  border-radius: 7px;
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  font-size: 12.5px;
  color: var(--mac-subtext);
  cursor: pointer;
  transition: all 0.15s;
}
.ghost-btn:hover { background: var(--mac-surface-strong); color: var(--mac-text); }
.ghost-btn.danger { color: #ff453a; border-color: rgba(255,69,58,0.3); }
.ghost-btn.danger:hover { background: var(--mac-danger-soft); }

.diagram-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.diagram-card {
  position: relative;
  background: var(--mac-card-fill);
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.18s;
  box-shadow: 0 2px 8px rgba(31,39,57,0.06);
}
.diagram-card:hover:not(.trashed) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(31,39,57,0.12);
  border-color: var(--mac-accent);
}
.diagram-card.trashed { opacity: 0.65; cursor: default; }

.card-preview {
  height: 120px;
  background: var(--mac-card-fill-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-bottom: 1px solid var(--mac-border-soft);
}

.card-type-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: var(--type-color);
  color: white;
  opacity: 0.9;
}

.card-info {
  padding: 10px 12px 12px;
}

.card-name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--mac-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}

.card-meta {
  font-size: 11.5px;
  color: var(--mac-muted);
}

.card-more-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  color: var(--mac-subtext);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s;
}
.diagram-card:hover .card-more-btn { opacity: 1; }

.rename-input-wrap { margin-bottom: 3px; }
.rename-input {
  width: 100%;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--mac-text);
  border: 1px solid var(--mac-accent);
  border-radius: 5px;
  padding: 2px 6px;
  outline: none;
  background: white;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--mac-muted);
  font-size: 14px;
  text-align: center;
}

.skeleton {
  height: 165px;
  background: linear-gradient(90deg, var(--mac-card-fill) 25%, var(--mac-card-fill-soft) 50%, var(--mac-card-fill) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  cursor: default;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.context-menu {
  position: fixed;
  z-index: 9999;
  background: var(--mac-surface-strong);
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  box-shadow: var(--mac-shadow-strong);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 5px;
  min-width: 160px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--mac-text);
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
}
.ctx-item:hover { background: var(--mac-accent-soft); color: var(--mac-accent); }
.ctx-item.danger { color: #ff453a; }
.ctx-item.danger:hover { background: var(--mac-danger-soft); color: #ff453a; }

.ctx-divider {
  height: 1px;
  background: var(--mac-border);
  margin: 4px 0;
}
</style>
