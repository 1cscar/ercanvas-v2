<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EditorShellHeader from '@/components/editor/common/EditorShellHeader.vue'
import ErDiagramEditor from '@/components/editor/ErDiagramEditor.vue'
import TableModelEditor from '@/components/editor/TableModelEditor.vue'
import { useAuthStore } from '@/stores/auth'
import { useDiagramsStore } from '@/stores/diagrams'
import { convertErToLogical } from '@/domain/converters/erToLogical'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const diagrams = useDiagramsStore()

const loading = ref(false)
const loadError = ref('')
const saveError = ref('')
const saveState = ref('idle') // idle | dirty | saving | saved | error
const draft = ref(null)
const sharePanelOpen = ref(false)
const sharePermission = ref('edit') // owner_only | read | edit
const shareCopyState = ref('')
const convertState = ref('idle') // idle | converting | error
const convertError = ref('')
let autosaveTimer = null

const diagramId = computed(() => String(route.query.id || ''))
const shareId = computed(() => String(route.query.share || ''))
const fallbackType = computed(() => String(route.query.type || 'er'))

const modeLabelMap = {
  er: 'ER 圖',
  logical: '邏輯模型',
  physical: '實體模型',
  table: '資料表',
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeEditorType(type) {
  if (type === 'logical') return 'logical'
  if (type === 'physical') return 'physical'
  if (type === 'table') return 'table'
  return 'er'
}

const editorType = computed(() => normalizeEditorType(draft.value?.type || fallbackType.value))

const subtitle = computed(() => {
  if (shareId.value) return `分享來源：${shareId.value}`
  if (!diagramId.value) return '尚未指定圖表 ID'
  return `圖表 ID：${diagramId.value}`
})

const shareLink = computed(() => {
  if (!diagramId.value) return ''
  if (typeof window === 'undefined') return ''
  const base = `${window.location.origin}/editor?id=${diagramId.value}&type=${editorType.value}`
  return `${base}&share=link&perm=${sharePermission.value}`
})

const saveStatusText = computed(() => {
  if (saveState.value === 'saving') return '儲存中...'
  if (saveState.value === 'saved') return '已儲存'
  if (saveState.value === 'dirty') return '尚未儲存'
  if (saveState.value === 'error') return '儲存失敗'
  return '已同步'
})

const saveStatusClass = computed(() => ({
  saving: saveState.value === 'saving',
  saved: saveState.value === 'saved',
  dirty: saveState.value === 'dirty',
  error: saveState.value === 'error',
}))

function clearAutosaveTimer() {
  if (!autosaveTimer) return
  clearTimeout(autosaveTimer)
  autosaveTimer = null
}

function scheduleAutosave() {
  clearAutosaveTimer()
  autosaveTimer = setTimeout(() => {
    saveNow().catch(() => {})
  }, 900)
}

function markDirty() {
  if (!draft.value) return
  saveState.value = 'dirty'
  saveError.value = ''
  scheduleAutosave()
}

async function saveNow(force = false) {
  if (!draft.value || !auth.user?.uid) return
  if (!force && saveState.value === 'saving') return

  clearAutosaveTimer()
  saveState.value = 'saving'
  saveError.value = ''

  try {
    await diagrams.saveDiagram(auth.user.uid, draft.value)
    saveState.value = 'saved'
    setTimeout(() => {
      if (saveState.value === 'saved') saveState.value = 'idle'
    }, 1400)
  } catch (error) {
    saveState.value = 'error'
    saveError.value = error?.message || '儲存圖表失敗'
  }
}

async function loadDiagram() {
  loadError.value = ''
  saveError.value = ''
  clearAutosaveTimer()

  if (!auth.user?.uid) return
  if (!diagramId.value) {
    draft.value = null
    loadError.value = '缺少圖表 ID，請回到圖表列表重新開啟。'
    return
  }
  loading.value = true
  try {
    const row = await diagrams.fetchDiagram(auth.user.uid, diagramId.value)
    if (!row) {
      draft.value = null
      loadError.value = '找不到圖表或你沒有權限。'
      return
    }

    draft.value = {
      id: row.id,
      type: normalizeEditorType(row.type || fallbackType.value),
      name: row.name || '未命名圖表',
      content: deepClone(row.content || {}),
      linkedErDiagramId: row.linkedErDiagramId ?? null,
      linkedLmDiagramId: row.linkedLmDiagramId ?? null,
    }
    sharePermission.value = String(row.content?.shareConfig?.permission || 'edit')
    sharePanelOpen.value = false
    shareCopyState.value = ''
    saveState.value = 'idle'
  } catch (error) {
    draft.value = null
    loadError.value = error?.message || '載入圖表失敗'
  } finally {
    loading.value = false
  }
}

function updateDiagramName(value) {
  if (!draft.value) return
  draft.value.name = value
  markDirty()
}

function updateDiagramContent(content) {
  if (!draft.value) return
  draft.value.content = deepClone(content || {})
  markDirty()
}

function toggleSharePanel() {
  sharePanelOpen.value = !sharePanelOpen.value
  shareCopyState.value = ''
}

function updateSharePermission(permission) {
  if (!draft.value) return
  sharePermission.value = permission
  draft.value.content = {
    ...(draft.value.content || {}),
    shareConfig: {
      ...((draft.value.content || {}).shareConfig || {}),
      permission,
    },
  }
  markDirty()
}

async function copyShareLink() {
  if (!shareLink.value) return
  try {
    await navigator.clipboard.writeText(shareLink.value)
    shareCopyState.value = '已複製'
  } catch (_) {
    shareCopyState.value = '複製失敗'
  }
}

async function convertToLogical() {
  if (!draft.value || editorType.value !== 'er' || !auth.user?.uid || convertState.value === 'converting') return
  convertState.value = 'converting'
  convertError.value = ''
  try {
    const converted = convertErToLogical({
      nodes: draft.value.content?.nodes || [],
      edges: draft.value.content?.edges || [],
      nextId: draft.value.content?.nextId || 1,
      existingTables: [],
    })

    const logicalId = await diagrams.createDiagram(auth.user.uid, 'logical')

    await diagrams.saveDiagram(auth.user.uid, {
      id: logicalId,
      type: 'logical',
      name: `${draft.value.name || '未命名圖表'}-邏輯`,
      content: {
        tables: converted.tables || [],
        fkLinks: [],
        nextId: converted.nextId || 1,
        linkedErDiagramId: draft.value.id,
      },
      linkedErDiagramId: draft.value.id,
      linkedLmDiagramId: null,
    })

    draft.value.linkedLmDiagramId = logicalId
    draft.value.content = {
      ...(draft.value.content || {}),
      linkedLmDiagramId: logicalId,
    }
    await saveNow(true)

    await router.push(`/editor?id=${logicalId}&type=logical`)
  } catch (error) {
    convertState.value = 'error'
    convertError.value = error?.message || 'ER 轉邏輯圖失敗'
    return
  }
  convertState.value = 'idle'
}

function goHome() {
  router.push('/home')
}

function reloadDiagram() {
  loadDiagram().catch(() => {})
}

watch(
  [diagramId, shareId, () => auth.user?.uid],
  () => {
    if (!auth.user?.uid) return
    loadDiagram().catch(() => {})
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearAutosaveTimer()
})
</script>

<template>
  <div class="editor-root">
    <EditorShellHeader
      title="Vue Diagram Editor"
      :subtitle="subtitle"
      :mode-label="modeLabelMap[editorType] || editorType"
      :disable-reload="loading"
      :disable-share="loading || !draft"
      @back="goHome"
      @reload="reloadDiagram"
      @share="toggleSharePanel"
    />

    <main class="editor-main">
      <div v-if="loading" class="state-card">
        <strong>載入中</strong>
        <p>正在從 Supabase 載入圖表資料...</p>
      </div>

      <div v-else-if="loadError" class="state-card error">
        <strong>載入失敗</strong>
        <p>{{ loadError }}</p>
      </div>

      <template v-else-if="draft">
        <section class="editor-meta">
          <div class="name-field">
            <label>圖表名稱</label>
            <input :value="draft.name" @input="updateDiagramName($event.target.value)" />
          </div>

          <div class="meta-actions">
            <span class="save-status" :class="saveStatusClass">{{ saveStatusText }}</span>
            <button
              v-if="editorType === 'er'"
              class="save-btn"
              :disabled="convertState === 'converting'"
              @click="convertToLogical"
            >
              {{ convertState === 'converting' ? '轉換中...' : 'ER 轉邏輯圖' }}
            </button>
            <button class="save-btn" :disabled="saveState === 'saving'" @click="saveNow(true)">
              立即儲存
            </button>
          </div>
        </section>

        <p v-if="saveError" class="save-error">{{ saveError }}</p>
        <p v-if="convertError" class="save-error">{{ convertError }}</p>

        <section v-if="sharePanelOpen" class="share-panel">
          <div class="share-row">
            <label>權限</label>
            <select :value="sharePermission" @change="updateSharePermission($event.target.value)">
              <option value="owner_only">僅自己</option>
              <option value="read">僅檢視</option>
              <option value="edit">可編輯</option>
            </select>
          </div>
          <div class="share-row">
            <label>分享連結</label>
            <input :value="shareLink" readonly />
            <button class="save-btn" @click="copyShareLink">複製連結</button>
          </div>
          <p class="share-tip">
            目前權限設定會存入圖表內容。若要真正跨帳號協作，需再加 Supabase share policy / token 機制。
            <span v-if="shareCopyState">（{{ shareCopyState }}）</span>
          </p>
        </section>

        <ErDiagramEditor
          v-if="editorType === 'er'"
          :key="`er-${draft.id}`"
          :content="draft.content"
          @update:content="updateDiagramContent"
        />

        <TableModelEditor
          v-else-if="editorType === 'logical'"
          :key="`logical-${draft.id}`"
          :content="draft.content"
          mode="logical"
          :show-fk="true"
          @update:content="updateDiagramContent"
        />

        <TableModelEditor
          v-else-if="editorType === 'physical'"
          :key="`physical-${draft.id}`"
          :content="draft.content"
          mode="physical"
          :show-fk="true"
          @update:content="updateDiagramContent"
        />

        <TableModelEditor
          v-else
          :key="`table-${draft.id}`"
          :content="draft.content"
          mode="table"
          :show-fk="false"
          @update:content="updateDiagramContent"
        />
      </template>

      <div v-else class="state-card">
        <strong>尚未指定圖表</strong>
        <p>請回到圖表列表，選擇一張圖表後再進入編輯器。</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.share-panel {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.share-row {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 8px;
  align-items: center;
}

.share-row label {
  font-size: 12px;
  color: var(--mac-subtext);
}

.share-row select,
.share-row input {
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 12px;
}

.share-tip {
  margin: 0;
  font-size: 12px;
  color: var(--mac-muted);
}

@media (max-width: 900px) {
  .share-row {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  height: 100vh;
  overflow: hidden;
  background: var(--mac-bg);
}

.editor-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.editor-meta {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.name-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 220px;
  flex: 1;
}

.name-field label {
  font-size: 12px;
  color: var(--mac-subtext);
}

.name-field input {
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  background: #fff;
}

.meta-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-status {
  font-size: 12px;
  color: var(--mac-subtext);
}

.save-status.saving {
  color: #4d76a9;
}

.save-status.saved {
  color: #2f8b62;
}

.save-status.dirty {
  color: #a57535;
}

.save-status.error {
  color: #bf4a41;
}

.save-btn {
  border: 1px solid rgba(10, 132, 255, 0.3);
  background: rgba(10, 132, 255, 0.13);
  color: var(--mac-accent);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.save-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.state-card {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  border-radius: 12px;
  padding: 12px;
}

.state-card.error {
  border-color: rgba(255, 69, 58, 0.35);
  background: rgba(255, 69, 58, 0.08);
}

.state-card strong {
  display: block;
  font-size: 13px;
  margin-bottom: 4px;
}

.state-card p,
.save-error {
  margin: 0;
  font-size: 12px;
  color: var(--mac-subtext);
}

.save-error {
  color: #bf4a41;
}

@media (max-width: 860px) {
  .editor-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .meta-actions {
    justify-content: space-between;
  }
}
</style>
